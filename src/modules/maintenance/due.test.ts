import assert from "node:assert/strict";
import test from "node:test";
import { computeNext, evaluateDue } from "./due";

const base = { today: "2026-10-15", dueSoonDays: 14, meterWarningPercent: 10 };
const date = (key: string) => new Date(`${key}T00:00:00Z`);

test("date-based due states", () => {
  assert.equal(evaluateDue({ ...base, nextServiceDate: date("2026-12-31") }).state, "OK");
  assert.equal(evaluateDue({ ...base, nextServiceDate: date("2026-10-29") }).state, "DUE_SOON"); // exactly 14 days
  assert.equal(evaluateDue({ ...base, nextServiceDate: date("2026-10-30") }).state, "OK");
  assert.equal(evaluateDue({ ...base, nextServiceDate: date("2026-10-15") }).state, "DUE");
  assert.equal(evaluateDue({ ...base, nextServiceDate: date("2026-10-14") }).state, "OVERDUE");
  assert.equal(evaluateDue({ ...base, nextServiceDate: null }).state, "OK");
});

test("a date-only value is never shifted: noon UTC is still the same calendar day", () => {
  assert.equal(evaluateDue({ ...base, nextServiceDate: new Date("2026-10-15T12:00:00Z") }).state, "DUE");
  assert.equal(evaluateDue({ ...base, nextServiceDate: new Date("2026-10-14T23:59:59Z") }).state, "OVERDUE");
});

test("meter-based due states", () => {
  const meter = { ...base, nextServiceMeter: 500, intervalMeter: 250 };
  assert.equal(evaluateDue({ ...meter, currentMeter: 100 }).state, "OK");
  assert.equal(evaluateDue({ ...meter, currentMeter: 475 }).state, "DUE_SOON"); // 25 left = 10% of 250
  assert.equal(evaluateDue({ ...meter, currentMeter: 474 }).state, "OK");
  assert.equal(evaluateDue({ ...meter, currentMeter: 500 }).state, "DUE");
  assert.equal(evaluateDue({ ...meter, currentMeter: 500.1 }).state, "OVERDUE");
  assert.equal(evaluateDue({ ...meter, currentMeter: null }).state, "OK", "no reading yet means nothing can be judged");
  assert.equal(evaluateDue({ ...meter, currentMeter: 510 }).meterRemaining, -10);
});

test("the most urgent of date and meter wins", () => {
  const both = { ...base, nextServiceDate: date("2026-12-31"), nextServiceMeter: 100, intervalMeter: 100 };
  assert.equal(evaluateDue({ ...both, currentMeter: 120 }).state, "OVERDUE");
  assert.equal(evaluateDue({ ...both, currentMeter: 10 }).state, "OK");
  assert.equal(evaluateDue({ ...both, nextServiceDate: date("2026-10-20"), currentMeter: 10 }).state, "DUE_SOON");
});

test("next service is computed from the interval", () => {
  assert.equal(computeNext({ intervalDays: null, intervalMonths: 12, intervalMeter: null }, date("2026-01-31"), null).nextDate?.toISOString().slice(0, 10), "2027-01-31");
  assert.equal(computeNext({ intervalDays: null, intervalMonths: 1, intervalMeter: null }, date("2026-01-31"), null).nextDate?.toISOString().slice(0, 10), "2026-02-28");
  assert.equal(computeNext({ intervalDays: 90, intervalMonths: null, intervalMeter: null }, date("2026-10-01"), null).nextDate?.toISOString().slice(0, 10), "2026-12-30");
  assert.deepEqual(computeNext({ intervalDays: null, intervalMonths: null, intervalMeter: { toString: () => "250.0" } }, date("2026-10-01"), 1000.5), { nextDate: null, nextMeter: 1250.5 });
  assert.deepEqual(computeNext({ intervalDays: null, intervalMonths: null, intervalMeter: { toString: () => "250" } }, date("2026-10-01"), null), { nextDate: null, nextMeter: null });
});
