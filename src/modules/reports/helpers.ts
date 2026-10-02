import { addDays, dateKeyInZone, dateKeyUtc, keyToDate, timeInputInZone } from "@/lib/datetime";
import { formatName } from "@/lib/format";
import { EXPORT_ROW_LIMIT, type Cell, type ReportContext } from "./types";

/** Date-only column value (UTC calendar date, never zone-shifted). */
export const dateCell = (date: Date | null | undefined): Cell => (date ? dateKeyUtc(date) : null);
/** Instant rendered in the viewer's zone. */
export const instantCell = (date: Date | null | undefined, zone: string): Cell => (date ? `${dateKeyInZone(date, zone)} ${timeInputInZone(date, zone)}` : null);
export const nameCell = (employee?: { firstName: string; preferredName: string | null; lastName: string; suffix: string | null } | null): Cell => (employee ? formatName(employee) : null);
export const label = (value: string | null | undefined): Cell => (value ? value.toLowerCase().replaceAll("_", " ") : null);

/** Pagination window; exports use one capped window. */
export function window(ctx: ReportContext) {
  if (ctx.pageSize === null) return { skip: 0, take: EXPORT_ROW_LIMIT };
  return { skip: (ctx.page - 1) * ctx.pageSize, take: ctx.pageSize };
}

/** In-memory paging for aggregate reports whose rows are computed, not queried one-to-one. */
export function pageRows(ctx: ReportContext, rows: Cell[][]) {
  const { skip, take } = window(ctx);
  return rows.slice(skip, skip + take);
}

/** Default date range helper: explicit filter values win, otherwise the last `days` days up to today. */
export function rangeOrDefault(ctx: ReportContext, defaultDays: number) {
  const to = ctx.filters.to ?? ctx.today;
  const from = ctx.filters.from ?? addDays(to, -defaultDays + 1);
  return { from, to, fromDate: keyToDate(from), toExclusive: keyToDate(addDays(to, 1)) };
}

export const OPEN_TASK_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED"] as const;
export const OPEN_INVOICE_STATUSES = ["ISSUED", "SENT", "PARTIALLY_PAID", "OVERDUE"] as const;
