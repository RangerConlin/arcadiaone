/**
 * Date helpers shared by the calendar, dashboard and notification jobs.
 *
 * Two kinds of temporal values exist in ArcadiaOne:
 *  - date-only values (task due dates, qualification expirations, milestone targets, ...)
 *    are stored as a Date whose *UTC calendar date* is the intended date. They are never
 *    converted to a time zone: 2026-03-01T00:00Z and 2026-03-01T12:00Z are both "Mar 1".
 *  - instants (rental reservations, signature expiry, native timed events) are stored in
 *    UTC and rendered in the organization/user time zone.
 *
 * A "day key" is a `YYYY-MM-DD` string. Day keys are plain calendar dates and are
 * compared lexicographically.
 */

export const DEFAULT_TIME_ZONE = "UTC";
const DAY_MS = 86_400_000;
const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidTimeZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Resolves user zone, then organization zone, then UTC. */
export function resolveTimeZone(userZone?: string | null, organizationZone?: string | null) {
  if (isValidTimeZone(userZone)) return userZone;
  if (isValidTimeZone(organizationZone)) return organizationZone;
  return DEFAULT_TIME_ZONE;
}

export function isDayKey(value: string | null | undefined): value is string {
  if (!value) return false;
  const match = KEY_PATTERN.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return dateKeyUtc(date) === value;
}

/** Day key of a date-only value (UTC calendar date). */
export function dateKeyUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** UTC midnight of a day key. */
export function keyToDate(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

export function addDays(key: string, days: number) {
  return dateKeyUtc(new Date(keyToDate(key).getTime() + days * DAY_MS));
}

export function diffDays(fromKey: string, toKey: string) {
  return Math.round((keyToDate(toKey).getTime() - keyToDate(fromKey).getTime()) / DAY_MS);
}

/** Day key of an instant as observed in a time zone. */
export function dateKeyInZone(instant: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function todayKey(zone: string, now = new Date()) {
  return dateKeyInZone(now, zone);
}

/** Offset (ms) of `zone` from UTC at the given instant. */
function zoneOffsetMs(instant: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour"), pick("minute"), pick("second"));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Converts a wall-clock day + time in `zone` to the corresponding UTC instant. */
export function zonedWallTimeToUtc(key: string, time: string, zone: string) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const [year, month, day] = key.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day, hours, minutes);
  let guess = wall - zoneOffsetMs(new Date(wall), zone);
  // Re-evaluate once so instants next to a DST change resolve to the right offset.
  guess = wall - zoneOffsetMs(new Date(guess), zone);
  return new Date(guess);
}

/** UTC instant of local midnight at the start of `key` in `zone`. */
export function startOfDayUtc(key: string, zone: string) {
  return zonedWallTimeToUtc(key, "00:00", zone);
}

/** `HH:mm` wall time of an instant in `zone`, for <input type="time">. */
export function timeInputInZone(instant: Date, zone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
}

export function formatTimeInZone(instant: Date, zone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(instant);
}

export function formatDateTimeInZone(instant: Date, zone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(instant);
}

/** Formats a day key without any time-zone shifting. */
export function formatDayKey(key: string, options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(keyToDate(key));
}

export function weekdayOf(key: string) {
  return keyToDate(key).getUTCDay();
}

/** First day (Sunday-based week start by default) of the week containing `key`. */
export function startOfWeek(key: string, weekStartsOn = 0) {
  return addDays(key, -((weekdayOf(key) - weekStartsOn + 7) % 7));
}

export function weekKeys(anchor: string, weekStartsOn = 0) {
  const first = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

export function startOfMonth(key: string) {
  return `${key.slice(0, 7)}-01`;
}

export function addMonths(key: string, months: number) {
  const [year, month] = key.split("-").map(Number);
  const index = year * 12 + (month - 1) + months;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** Weeks of day keys covering the month containing `anchor`, padded to whole weeks. */
export function monthGrid(anchor: string, weekStartsOn = 0) {
  const first = startOfMonth(anchor);
  const next = addMonths(first, 1);
  const lastDay = addDays(next, -1);
  const start = startOfWeek(first, weekStartsOn);
  const end = addDays(startOfWeek(lastDay, weekStartsOn), 6);
  const weeks: string[][] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(cursor, index)));
  }
  return weeks;
}

/** Inclusive day-key list between two keys, capped to avoid runaway ranges. */
export function eachDayKey(from: string, to: string, max = 400) {
  const keys: string[] = [];
  for (let cursor = from; cursor <= to && keys.length < max; cursor = addDays(cursor, 1)) keys.push(cursor);
  return keys;
}
