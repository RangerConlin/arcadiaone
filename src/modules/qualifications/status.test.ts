import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateExpirationDate,
  evaluateRequirements,
  getQualificationStatus,
} from "./status";

const now = new Date("2026-10-01T12:00:00Z");

test("classifies non-expiring, expired, warning-window, and current credentials", () => {
  assert.equal(getQualificationStatus(null, 60, now), "NO_EXPIRATION");
  assert.equal(getQualificationStatus("2026-09-30", 60, now), "EXPIRED");
  assert.equal(getQualificationStatus("2026-11-30", 60, now), "EXPIRING_SOON");
  assert.equal(getQualificationStatus("2027-01-01", 60, now), "CURRENT");
});

test("calculates validity in calendar months and clamps month-end", () => {
  assert.equal(
    calculateExpirationDate(new Date("2025-01-31T00:00:00Z"), 1).toISOString(),
    "2025-02-28T00:00:00.000Z",
  );
});

test("requirements distinguish missing, expired, and unverified", () => {
  const requirements = [
    { qualificationTypeId: "missing", required: true },
    { qualificationTypeId: "expired", required: true },
    { qualificationTypeId: "pending", required: true },
  ];
  const results = evaluateRequirements(
    requirements,
    [
      { qualificationTypeId: "expired", expirationDate: "2026-09-01", verificationStatus: "VERIFIED" },
      { qualificationTypeId: "pending", expirationDate: null, verificationStatus: "UNVERIFIED" },
    ],
    60,
    now,
  );
  assert.deepEqual(results.map((item) => item.status), ["MISSING", "EXPIRED", "UNVERIFIED"]);
});
