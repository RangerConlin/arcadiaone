import type { AuthenticatedUser } from "@/lib/auth/session";
import { addDays, resolveTimeZone } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import {
  approvalItems, buildContext, eventItems, invoiceItems, milestoneItems, projectItems,
  qualificationItems, rentalItems, signatureItems, taskItems, type SourceContext,
} from "./sources";
import { calendarRange, type CalendarFilters, type CalendarItem, type CalendarItemType, type CalendarRange } from "./types";

const SOURCES: Record<CalendarItemType, (ctx: SourceContext) => Promise<CalendarItem[]>> = {
  PROJECT: projectItems, MILESTONE: milestoneItems, TASK: taskItems, RENTAL: rentalItems,
  QUALIFICATION: qualificationItems, INVOICE: invoiceItems, SIGNATURE: signatureItems,
  APPROVAL: approvalItems, EVENT: eventItems,
};

export type CalendarResult = {
  items: CalendarItem[];
  range: CalendarRange;
  zone: string;
  /** Sources that hit their per-source cap; the view should suggest narrowing filters. */
  truncated: boolean;
};

export async function getViewerTimeZone(user: AuthenticatedUser) {
  const [account, organization] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { timezone: true } }),
    prisma.organization.findUnique({ where: { id: user.organizationId }, select: { timezone: true } }),
  ]);
  return resolveTimeZone(account?.timezone, organization?.timezone);
}

export const sortCalendarItems = (a: CalendarItem, b: CalendarItem) =>
  a.startKey.localeCompare(b.startKey) ||
  Number(b.allDay) - Number(a.allDay) ||
  (a.startAt?.getTime() ?? 0) - (b.startAt?.getTime() ?? 0) ||
  a.type.localeCompare(b.type) || a.title.localeCompare(b.title);

/**
 * Aggregates calendar items for a user. Each source applies its owning module's
 * visibility policy, so the calendar can never show a record the user could not open.
 */
export async function getCalendarItems(
  user: AuthenticatedUser,
  filters: CalendarFilters,
  options: { zone?: string; range?: CalendarRange; now?: Date } = {},
): Promise<CalendarResult> {
  const zone = options.zone ?? (await getViewerTimeZone(user));
  const range = options.range ?? calendarRange(filters);
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: user.organizationId }, select: { qualificationExpirationWarningDays: true },
  });
  const ctx = buildContext(user, zone, range, filters, organization, options.now);
  const wanted = filters.types.length ? filters.types : (Object.keys(SOURCES) as CalendarItemType[]);
  const results = await Promise.all(wanted.map((type) => SOURCES[type](ctx)));
  const items = results.flat().sort(sortCalendarItems);
  return { items, range, zone, truncated: results.some((list) => list.length >= 500) };
}

export function groupByDay(items: CalendarItem[], fromKey: string, toKey: string) {
  const days = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const start = item.startKey < fromKey ? fromKey : item.startKey;
    const end = item.endKey > toKey ? toKey : item.endKey;
    // Spans are bucketed per day, capped to avoid pathological ranges.
    let cursor = start;
    for (let guard = 0; cursor <= end && guard < 400; guard += 1) {
      const list = days.get(cursor) ?? [];
      list.push(item);
      days.set(cursor, list);
      cursor = addDays(cursor, 1);
    }
  }
  return days;
}
