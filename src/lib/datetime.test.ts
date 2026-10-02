import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays, addMonths, dateKeyInZone, dateKeyUtc, isDayKey, monthGrid, resolveTimeZone,
  startOfDayUtc, startOfWeek, weekKeys, zonedWallTimeToUtc,
} from "./datetime";

test("date-only values keep their UTC calendar date regardless of zone", () => {
  // Midnight and noon UTC are both March 1; viewing in Honolulu must not shift them.
  assert.equal(dateKeyUtc(new Date("2026-03-01T00:00:00Z")), "2026-03-01");
  assert.equal(dateKeyUtc(new Date("2026-03-01T12:00:00Z")), "2026-03-01");
  // An instant, in contrast, does move with the zone.
  assert.equal(dateKeyInZone(new Date("2026-03-01T02:00:00Z"), "America/Chicago"), "2026-02-28");
  assert.equal(dateKeyInZone(new Date("2026-03-01T02:00:00Z"), "Asia/Tokyo"), "2026-03-01");
});

test("local wall time converts to UTC across daylight saving", () => {
  assert.equal(zonedWallTimeToUtc("2026-01-15", "09:00", "America/New_York").toISOString(), "2026-01-15T14:00:00.000Z");
  assert.equal(zonedWallTimeToUtc("2026-07-15", "09:00", "America/New_York").toISOString(), "2026-07-15T13:00:00.000Z");
  assert.equal(startOfDayUtc("2026-03-08", "America/New_York").toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(startOfDayUtc("2026-03-09", "America/New_York").toISOString(), "2026-03-09T04:00:00.000Z");
});

test("day key arithmetic and validation", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-01");
  assert.equal(addMonths("2026-01-31", -1), "2025-12-01");
  assert.ok(isDayKey("2026-02-28"));
  assert.ok(!isDayKey("2026-02-30"));
  assert.ok(!isDayKey("tomorrow"));
});

test("month grid covers whole weeks", () => {
  const grid = monthGrid("2026-10-15");
  assert.ok(grid.every((week) => week.length === 7));
  assert.equal(grid[0][0], "2026-09-27");
  assert.equal(grid.at(-1)?.[6], "2026-10-31");
  assert.equal(startOfWeek("2026-10-02"), "2026-09-27");
  assert.deepEqual(weekKeys("2026-10-02").length, 7);
});

test("time zone resolution falls back safely", () => {
  assert.equal(resolveTimeZone("Not/AZone", "America/Denver"), "America/Denver");
  assert.equal(resolveTimeZone(null, "bogus"), "UTC");
  assert.equal(resolveTimeZone("Europe/London", "America/Denver"), "Europe/London");
});
