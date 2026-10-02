import { addDays, dateKeyUtc, diffDays } from "@/lib/datetime";
import { calculateExpirationDate } from "@/modules/qualifications/status";

/**
 * Maintenance due logic, in one place. States are always *derived* from the schedule's next
 * service date/meter, the equipment's latest meter reading and today's date; nothing stores them.
 *
 *   OK        nothing is near
 *   DUE_SOON  within `dueSoonDays` of the date, or within `meterWarningPercent` of the meter interval
 *   DUE       the service date is today, or the meter has reached the target exactly
 *   OVERDUE   the date has passed, or the meter has gone past the target
 *
 * When a schedule has both a date and a meter, the most urgent applies.
 */
export const DUE_STATES = ["OK", "DUE_SOON", "DUE", "OVERDUE"] as const;
export type DueState = (typeof DUE_STATES)[number];
const RANK: Record<DueState, number> = { OK: 0, DUE_SOON: 1, DUE: 2, OVERDUE: 3 };
export const moreUrgent = (a: DueState, b: DueState) => (RANK[a] >= RANK[b] ? a : b);

export type DueInput = {
  /** Date-only values; only their UTC calendar date matters. */
  nextServiceDate?: Date | null;
  nextServiceMeter?: { toString(): string } | number | string | null;
  intervalMeter?: { toString(): string } | number | string | null;
  currentMeter?: { toString(): string } | number | string | null;
  /** Viewer/organization-zone calendar day, YYYY-MM-DD. */
  today: string;
  dueSoonDays: number;
  meterWarningPercent: number;
};

export type DueResult = { state: DueState; daysUntil: number | null; meterRemaining: number | null; reasons: string[] };

const num = (value: DueInput["nextServiceMeter"]) => (value === null || value === undefined || value === "" ? null : Number(value.toString()));

export function evaluateDue(input: DueInput): DueResult {
  let state: DueState = "OK";
  const reasons: string[] = [];
  let daysUntil: number | null = null;
  let meterRemaining: number | null = null;

  if (input.nextServiceDate) {
    daysUntil = diffDays(input.today, dateKeyUtc(input.nextServiceDate));
    if (daysUntil < 0) { state = moreUrgent(state, "OVERDUE"); reasons.push(`${-daysUntil} day${daysUntil === -1 ? "" : "s"} past the service date`); }
    else if (daysUntil === 0) { state = moreUrgent(state, "DUE"); reasons.push("service date is today"); }
    else if (daysUntil <= input.dueSoonDays) { state = moreUrgent(state, "DUE_SOON"); reasons.push(`service date in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`); }
  }

  const target = num(input.nextServiceMeter), current = num(input.currentMeter);
  if (target !== null && current !== null) {
    meterRemaining = Math.round((target - current) * 10) / 10;
    if (meterRemaining < 0) { state = moreUrgent(state, "OVERDUE"); reasons.push(`meter ${-meterRemaining} past the service point`); }
    else if (meterRemaining === 0) { state = moreUrgent(state, "DUE"); reasons.push("meter has reached the service point"); }
    else {
      const basis = num(input.intervalMeter) ?? target;
      if (basis > 0 && meterRemaining <= (basis * input.meterWarningPercent) / 100) { state = moreUrgent(state, "DUE_SOON"); reasons.push(`${meterRemaining} left on the meter`); }
    }
  }
  return { state, daysUntil, meterRemaining, reasons };
}

/** Next service point after a service performed on `serviceDate` at `meter`, from the schedule's intervals. */
export function computeNext(schedule: { intervalDays: number | null; intervalMonths: number | null; intervalMeter: { toString(): string } | null }, serviceDate: Date, meter: number | null) {
  let nextDate: Date | null = null;
  if (schedule.intervalMonths) nextDate = calculateExpirationDate(serviceDate, schedule.intervalMonths);
  else if (schedule.intervalDays) nextDate = new Date(`${addDays(dateKeyUtc(serviceDate), schedule.intervalDays)}T00:00:00.000Z`);
  const interval = num(schedule.intervalMeter);
  const nextMeter = interval !== null && meter !== null ? Math.round((meter + interval) * 10) / 10 : null;
  return { nextDate, nextMeter };
}
