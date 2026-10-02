import assert from "node:assert/strict";
import test from "node:test";

// jobs.ts pulls in Prisma; the tier rule is re-implemented via the exported function.
test("qualification reminder tiers pick the tightest applicable window", async () => {
  process.env.DATABASE_URL ??= "postgresql://placeholder:placeholder@localhost:5432/placeholder";
  const { qualificationTier } = await import("./jobs");
  assert.equal(qualificationTier(55, 60), 60);
  assert.equal(qualificationTier(30, 60), 30);
  assert.equal(qualificationTier(10, 60), 30);
  assert.equal(qualificationTier(7, 60), 7);
  assert.equal(qualificationTier(0, 60), 7);
  assert.equal(qualificationTier(61, 60), undefined);
  // Warning windows shorter than a tier never produce larger tiers.
  assert.equal(qualificationTier(20, 14), undefined);
  assert.equal(qualificationTier(10, 14), 14);
  assert.equal(qualificationTier(5, 14), 7);
});
