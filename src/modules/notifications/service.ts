import type { Prisma } from "@/generated/prisma/client";
import type { NotificationCategory, NotificationChannel, NotificationEntityType, NotificationType, UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { availableChannels } from "./channels";
import { NOTIFICATION_PAGE_SIZE, TYPE_CATEGORY, isDismissible } from "./constants";
import { safeActionUrl } from "./links";

/**
 * The only place that inserts Notification rows. Everything else calls the typed helpers
 * in events.ts / jobs.ts, which end up here, so recipient eligibility, preferences,
 * link safety and idempotency are enforced once.
 */

export type NotifyInput = {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entity?: { type: NotificationEntityType; id: string };
  /** Must come from `notificationLinks`; validated again against the route allow-list. */
  actionUrl?: string;
  /** Idempotency key. Scheduled checks always provide one; immediate events may. */
  dedupeKey?: string;
};

type Recipient = { id: string; role: UserRole; active: boolean; disabled: Set<NotificationCategory> };

/** Per-run cache so large job runs look each recipient up once. */
export class RecipientCache {
  private readonly cache = new Map<string, Recipient | null>();
  constructor(private readonly organizationId: string) {}

  async get(userId: string): Promise<Recipient | null> {
    if (this.cache.has(userId)) return this.cache.get(userId) ?? null;
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId: this.organizationId, active: true },
      select: { id: true, role: true, active: true },
    });
    let recipient: Recipient | null = null;
    if (user) {
      const off = await prisma.notificationPreference.findMany({
        where: { userId, channel: "IN_APP", enabled: false }, select: { category: true },
      });
      recipient = { ...user, disabled: new Set(off.map((row) => row.category)) };
    }
    this.cache.set(userId, recipient);
    return recipient;
  }
}

export type NotifyResult = "created" | "duplicate" | "skipped";

export async function notify(input: NotifyInput, cache = new RecipientCache(input.organizationId)): Promise<NotifyResult> {
  const category = TYPE_CATEGORY[input.type];
  const recipient = await cache.get(input.userId);
  if (!recipient) return "skipped";
  // Financial notifications never go to roles that cannot open financial records.
  if (category === "INVOICES" && recipient.role === "EMPLOYEE") return "skipped";
  if (recipient.disabled.has(category)) return "skipped";
  const result = await prisma.notification.createMany({
    data: [{
      organizationId: input.organizationId,
      userId: input.userId,
      type: input.type,
      category,
      title: input.title.slice(0, 200),
      message: input.message.slice(0, 1000),
      relatedEntityType: input.entity?.type ?? null,
      relatedEntityId: input.entity?.id ?? null,
      actionUrl: safeActionUrl(input.actionUrl),
      dedupeKey: input.dedupeKey ?? null,
    }],
    skipDuplicates: true,
  });
  return result.count ? "created" : "duplicate";
}

/** Immediate-event notifications must never break the business action that triggered them. */
export async function notifySafely(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (error) {
    console.error("[notifications] failed to create notification:", error instanceof Error ? error.message : error);
  }
}

export async function userIdsForEmployees(organizationId: string, employeeIds: Array<string | null | undefined>) {
  const ids = [...new Set(employeeIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map<string, string>();
  const users = await prisma.user.findMany({
    where: { organizationId, employeeId: { in: ids }, active: true }, select: { id: true, employeeId: true },
  });
  return new Map(users.map((user) => [user.employeeId!, user.id]));
}

// ---------------------------------------------------------------------------
// Reading and managing a user's own notifications. Every query is scoped by both the
// authenticated user and organization; ids from the browser are never trusted alone.
// ---------------------------------------------------------------------------

export type Viewer = { id: string; organizationId: string };
export type NotificationFilter = "unread" | "all" | "dismissed";

const visible = (viewer: Viewer): Prisma.NotificationWhereInput => ({ userId: viewer.id, organizationId: viewer.organizationId, archivedAt: null });

function filterWhere(viewer: Viewer, filter: NotificationFilter): Prisma.NotificationWhereInput {
  if (filter === "unread") return { ...visible(viewer), readAt: null, dismissedAt: null };
  if (filter === "dismissed") return { ...visible(viewer), dismissedAt: { not: null } };
  return { ...visible(viewer), dismissedAt: null };
}

export async function listNotifications(viewer: Viewer, filter: NotificationFilter, page: number, pageSize = NOTIFICATION_PAGE_SIZE) {
  const where = filterWhere(viewer, filter);
  const safePage = Math.max(1, Math.floor(page) || 1);
  const [items, total] = await prisma.$transaction([
    prisma.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (safePage - 1) * pageSize, take: pageSize }),
    prisma.notification.count({ where }),
  ]);
  return { items, total, page: safePage, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export const unreadCount = (viewer: Viewer) => prisma.notification.count({ where: filterWhere(viewer, "unread") });

export async function markRead(viewer: Viewer, id: string) {
  const result = await prisma.notification.updateMany({ where: { ...visible(viewer), id, readAt: null }, data: { readAt: new Date() } });
  return result.count;
}

export async function markAllRead(viewer: Viewer) {
  const result = await prisma.notification.updateMany({ where: { ...filterWhere(viewer, "unread") }, data: { readAt: new Date() } });
  return result.count;
}

/** Returns false when the notification is missing, not yours, or not dismissible. */
export async function dismiss(viewer: Viewer, id: string) {
  const notification = await prisma.notification.findFirst({ where: { ...visible(viewer), id }, select: { type: true } });
  if (!notification || !isDismissible(notification.type)) return false;
  const now = new Date();
  await prisma.notification.updateMany({ where: { ...visible(viewer), id }, data: { dismissedAt: now, readAt: now } });
  return true;
}

/** Link target for the open-redirect-safe /notifications/open/[id] route. */
export async function getOpenTarget(viewer: Viewer, id: string) {
  const notification = await prisma.notification.findFirst({ where: { ...visible(viewer), id }, select: { id: true, actionUrl: true } });
  if (!notification) return null;
  await markRead(viewer, id);
  return safeActionUrl(notification.actionUrl);
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export async function getPreferences(viewer: Viewer) {
  const rows = await prisma.notificationPreference.findMany({ where: { userId: viewer.id, organizationId: viewer.organizationId } });
  const lookup = new Map(rows.map((row) => [`${row.category}:${row.channel}`, row.enabled]));
  return (category: NotificationCategory, channel: NotificationChannel) => lookup.get(`${category}:${channel}`) ?? channel === "IN_APP";
}

export async function setInAppPreference(viewer: Viewer, category: NotificationCategory, enabled: boolean) {
  if (!availableChannels().includes("IN_APP")) return;
  await prisma.notificationPreference.upsert({
    where: { userId_category_channel: { userId: viewer.id, category, channel: "IN_APP" } },
    create: { organizationId: viewer.organizationId, userId: viewer.id, category, channel: "IN_APP", enabled },
    update: { enabled },
  });
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Archives (hides from lists, keeps the row and its idempotency key) read or dismissed
 * notifications older than the organization's retention window. Keeping the row is what
 * stops a still-true condition from being re-notified after cleanup.
 */
export async function archiveOldNotifications(organizationId: string, olderThanDays: number, now = new Date()) {
  if (olderThanDays <= 0) return 0;
  const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000);
  const result = await prisma.notification.updateMany({
    where: { organizationId, archivedAt: null, createdAt: { lt: cutoff }, OR: [{ readAt: { not: null } }, { dismissedAt: { not: null } }] },
    data: { archivedAt: now },
  });
  return result.count;
}
