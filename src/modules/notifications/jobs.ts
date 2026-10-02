import { addDays, dateKeyUtc, diffDays, keyToDate, resolveTimeZone, todayKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { notificationLinks } from "./links";
import { archiveOldNotifications, notify, RecipientCache, userIdsForEmployees, type NotifyInput } from "./service";

/**
 * Condition-based notifications. Each run evaluates real business state and emits a
 * notification only when its idempotency key is new:
 *
 *   dedupeKey = "<condition>:<record id>:<the date the condition is about>[:<tier>]"
 *
 * The key lives in Notification.dedupeKey under a unique (userId, dedupeKey) index, so
 * running the job every minute or twice at once produces exactly one notification per
 * recipient per condition. Because the due/expiry date is part of the key, moving a
 * due date or renewing a credential starts a fresh cycle. Reading or dismissing a
 * notification never frees its key, and retention only archives rows (never deletes them).
 *
 * This module must stay free of Next.js-only imports: the worker process loads it directly.
 */

/** Old overdue items are not announced retroactively (avoids a flood on first deploy). */
export const OVERDUE_LOOKBACK_DAYS = 30;
/** Extra qualification reminder tiers (days before expiry), capped by the org warning window. */
const QUALIFICATION_TIERS = [30, 7];
const RECIPIENT_BATCH = 500;

export type JobSummary = {
  organizations: number;
  created: Record<string, number>;
  alreadyNotified: number;
  skipped: number;
  archived: number;
};

type Candidate = NotifyInput & { dedupeKey: string };

type OrgSettings = {
  id: string;
  timezone: string;
  taskDueSoonDays: number;
  rentalDueSoonDays: number;
  invoiceDueSoonDays: number;
  qualificationExpirationWarningDays: number;
  notificationArchiveAfterDays: number;
};

/** Drops candidates whose key already exists with one query per batch instead of one write each. */
async function emit(organization: OrgSettings, candidates: Candidate[], cache: RecipientCache, summary: JobSummary) {
  for (let start = 0; start < candidates.length; start += RECIPIENT_BATCH) {
    const batch = candidates.slice(start, start + RECIPIENT_BATCH);
    const existing = await prisma.notification.findMany({
      where: { organizationId: organization.id, dedupeKey: { in: batch.map((c) => c.dedupeKey) } },
      select: { userId: true, dedupeKey: true },
    });
    const seen = new Set(existing.map((row) => `${row.userId}|${row.dedupeKey}`));
    for (const candidate of batch) {
      if (seen.has(`${candidate.userId}|${candidate.dedupeKey}`)) {
        summary.alreadyNotified += 1;
        continue;
      }
      const result = await notify(candidate, cache); // the unique index is the final guard
      if (result === "created") summary.created[candidate.type] = (summary.created[candidate.type] ?? 0) + 1;
      else if (result === "duplicate") summary.alreadyNotified += 1;
      else summary.skipped += 1;
    }
  }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

async function taskCandidates(org: OrgSettings, today: string): Promise<Candidate[]> {
  const horizon = addDays(today, org.taskDueSoonDays + 1);
  const oldest = addDays(today, -OVERDUE_LOOKBACK_DAYS);
  const tasks = await prisma.task.findMany({
    where: {
      organizationId: org.id, status: { notIn: ["COMPLETED", "CANCELLED"] }, assignedToEmployeeId: { not: null },
      dueDate: { gte: keyToDate(oldest), lt: keyToDate(horizon) },
    },
    select: { id: true, title: true, dueDate: true, assignedToEmployeeId: true },
  });
  const users = await userIdsForEmployees(org.id, tasks.map((task) => task.assignedToEmployeeId));
  const candidates: Candidate[] = [];
  for (const task of tasks) {
    const userId = users.get(task.assignedToEmployeeId!);
    if (!userId || !task.dueDate) continue;
    const dueKey = dateKeyUtc(task.dueDate);
    const days = diffDays(today, dueKey);
    const base = { organizationId: org.id, userId, entity: { type: "TASK" as const, id: task.id }, actionUrl: notificationLinks.task(task.id) };
    if (days < 0) {
      candidates.push({ ...base, type: "TASK_OVERDUE", title: "Task overdue", message: `${task.title} was due ${dueKey} (${plural(-days, "day")} ago).`, dedupeKey: `task-overdue:${task.id}:${dueKey}` });
    } else if (days === 1) {
      candidates.push({ ...base, type: "TASK_DUE_TOMORROW", title: "Task due tomorrow", message: `${task.title} is due ${dueKey}.`, dedupeKey: `task-due-tomorrow:${task.id}:${dueKey}` });
    } else if (days <= org.taskDueSoonDays) {
      candidates.push({ ...base, type: "TASK_DUE_SOON", title: "Task due soon", message: days === 0 ? `${task.title} is due today.` : `${task.title} is due in ${plural(days, "day")} (${dueKey}).`, dedupeKey: `task-due-soon:${task.id}:${dueKey}` });
    }
  }
  return candidates;
}

/** The tightest reminder tier that currently applies, so a late first sighting sends one reminder, not three. */
export function qualificationTier(daysUntil: number, warningDays: number) {
  const tiers = [...new Set([warningDays, ...QUALIFICATION_TIERS.filter((tier) => tier < warningDays)])].sort((a, b) => a - b);
  return tiers.find((tier) => daysUntil <= tier);
}

async function qualificationCandidates(org: OrgSettings, today: string): Promise<Candidate[]> {
  const rows = await prisma.employeeQualification.findMany({
    where: {
      organizationId: org.id, archivedAt: null,
      expirationDate: { gte: keyToDate(addDays(today, -OVERDUE_LOOKBACK_DAYS)), lt: keyToDate(addDays(today, org.qualificationExpirationWarningDays + 1)) },
      employee: { employmentStatus: { in: ["ACTIVE", "LEAVE"] } },
    },
    select: { id: true, employeeId: true, expirationDate: true, qualificationType: { select: { name: true } } },
  });
  const users = await userIdsForEmployees(org.id, rows.map((row) => row.employeeId));
  const candidates: Candidate[] = [];
  for (const row of rows) {
    const userId = users.get(row.employeeId);
    if (!userId || !row.expirationDate) continue;
    const expKey = dateKeyUtc(row.expirationDate);
    const days = diffDays(today, expKey);
    const base = { organizationId: org.id, userId, entity: { type: "EMPLOYEE_QUALIFICATION" as const, id: row.id }, actionUrl: notificationLinks.qualification(row.employeeId) };
    if (days < 0) {
      candidates.push({ ...base, type: "QUALIFICATION_EXPIRED", title: "Qualification expired", message: `${row.qualificationType.name} expired on ${expKey}.`, dedupeKey: `qualification-expired:${row.id}:${expKey}` });
      continue;
    }
    const tier = qualificationTier(days, org.qualificationExpirationWarningDays);
    if (tier === undefined) continue;
    candidates.push({
      ...base, type: "QUALIFICATION_EXPIRING", title: "Qualification expiring",
      message: days === 0 ? `${row.qualificationType.name} expires today.` : `${row.qualificationType.name} expires in ${plural(days, "day")} (${expKey}).`,
      dedupeKey: `qualification-expiring:${row.id}:${expKey}:${tier}`,
    });
  }
  return candidates;
}

async function rentalCandidates(org: OrgSettings, now: Date): Promise<Candidate[]> {
  const soonEnd = new Date(now.getTime() + org.rentalDueSoonDays * 86_400_000);
  const oldest = new Date(now.getTime() - OVERDUE_LOOKBACK_DAYS * 86_400_000);
  const rentals = await prisma.rental.findMany({
    where: { organizationId: org.id, status: { in: ["CHECKED_OUT", "PARTIALLY_RETURNED"] }, reservationEnd: { gte: oldest, lte: soonEnd } },
    select: {
      id: true, rentalNumber: true, reservationEnd: true, createdByUserId: true,
      checkedOutByEmployeeId: true, preparedByEmployeeId: true, client: { select: { name: true } },
    },
  });
  const employeeUsers = await userIdsForEmployees(org.id, rentals.flatMap((r) => [r.checkedOutByEmployeeId, r.preparedByEmployeeId]));
  const candidates: Candidate[] = [];
  for (const rental of rentals) {
    const recipients = new Set([rental.createdByUserId, employeeUsers.get(rental.checkedOutByEmployeeId ?? ""), employeeUsers.get(rental.preparedByEmployeeId ?? "")].filter((id): id is string => Boolean(id)));
    const endStamp = rental.reservationEnd.toISOString();
    const overdue = rental.reservationEnd < now;
    const label = `Rental ${rental.rentalNumber}${rental.client ? ` (${rental.client.name})` : ""}`;
    for (const userId of recipients) {
      candidates.push({
        organizationId: org.id, userId, entity: { type: "RENTAL", id: rental.id }, actionUrl: notificationLinks.rental(rental.id),
        type: overdue ? "RENTAL_OVERDUE" : "RENTAL_DUE_SOON",
        title: overdue ? "Rental overdue" : "Rental due back soon",
        message: overdue ? `${label} was due back ${endStamp.slice(0, 10)} and has not been returned.` : `${label} is due back ${endStamp.slice(0, 10)}.`,
        dedupeKey: `${overdue ? "rental-overdue" : "rental-due-soon"}:${rental.id}:${endStamp}`,
      });
    }
  }
  return candidates;
}

async function invoiceCandidates(org: OrgSettings, today: string): Promise<Candidate[]> {
  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId: org.id, status: { in: ["ISSUED", "SENT", "PARTIALLY_PAID", "OVERDUE"] }, balanceDue: { gt: 0 },
      dueDate: { gte: keyToDate(addDays(today, -OVERDUE_LOOKBACK_DAYS)), lt: keyToDate(addDays(today, org.invoiceDueSoonDays + 1)) },
    },
    select: {
      id: true, invoiceNumber: true, dueDate: true, currency: true, balanceDue: true, createdByUserId: true,
      client: { select: { name: true } }, project: { select: { projectManagerId: true } },
    },
  });
  const managerUsers = await userIdsForEmployees(org.id, invoices.map((invoice) => invoice.project?.projectManagerId));
  const candidates: Candidate[] = [];
  for (const invoice of invoices) {
    if (!invoice.dueDate) continue;
    const dueKey = dateKeyUtc(invoice.dueDate);
    const days = diffDays(today, dueKey);
    const overdue = days < 0;
    const recipients = new Set([invoice.createdByUserId, managerUsers.get(invoice.project?.projectManagerId ?? "")].filter((id): id is string => Boolean(id)));
    const label = `${invoice.invoiceNumber ?? "Invoice"} for ${invoice.client.name}`;
    for (const userId of recipients) {
      candidates.push({
        organizationId: org.id, userId, entity: { type: "INVOICE", id: invoice.id }, actionUrl: notificationLinks.invoice(invoice.id),
        type: overdue ? "INVOICE_OVERDUE" : "INVOICE_DUE_SOON",
        title: overdue ? "Invoice overdue" : "Invoice due soon",
        message: overdue
          ? `${label} was due ${dueKey}; ${invoice.currency} ${String(invoice.balanceDue)} is outstanding.`
          : `${label} is due ${days === 0 ? "today" : dueKey}; ${invoice.currency} ${String(invoice.balanceDue)} outstanding.`,
        dedupeKey: `${overdue ? "invoice-overdue" : "invoice-due-soon"}:${invoice.id}:${dueKey}`,
      });
    }
  }
  return candidates;
}

export async function runNotificationJobs(options: { now?: Date; organizationId?: string; log?: (line: string) => void } = {}): Promise<JobSummary> {
  const now = options.now ?? new Date();
  const summary: JobSummary = { organizations: 0, created: {}, alreadyNotified: 0, skipped: 0, archived: 0 };
  const organizations = await prisma.organization.findMany({
    where: options.organizationId ? { id: options.organizationId } : undefined,
    select: {
      id: true, timezone: true, taskDueSoonDays: true, rentalDueSoonDays: true, invoiceDueSoonDays: true,
      qualificationExpirationWarningDays: true, notificationArchiveAfterDays: true,
    },
  });
  for (const row of organizations) {
    // Each organization is processed independently so one failure cannot starve the others.
    try {
      const org: OrgSettings = { ...row, timezone: resolveTimeZone(null, row.timezone) };
      const today = todayKey(org.timezone, now);
      const cache = new RecipientCache(org.id);
      for (const build of [
        () => taskCandidates(org, today), () => qualificationCandidates(org, today),
        () => rentalCandidates(org, now), () => invoiceCandidates(org, today),
      ]) {
        await emit(org, await build(), cache, summary);
      }
      summary.archived += await archiveOldNotifications(org.id, org.notificationArchiveAfterDays, now);
      summary.organizations += 1;
    } catch (error) {
      options.log?.(`organization ${row.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return summary;
}
