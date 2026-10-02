/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { diffChanges, isSensitiveKey, sanitizeMetadata, sanitizeValue } from "./sanitize";

test("sensitive keys are recognized", () => {
  for (const key of ["password", "passwordHash", "newPassword", "token", "sessionToken", "tokenHash", "apiKey", "api_key", "secret", "Authorization", "cookie", "storageKey", "checksum", "credentialNumber"]) assert.ok(isSensitiveKey(key), key);
  for (const key of ["status", "role", "dueDate", "amount", "email"]) assert.ok(!isSensitiveKey(key), key);
});

test("metadata drops secrets recursively and flattens values", () => {
  const out = sanitizeMetadata({
    status: "ACTIVE", password: "hunter2", nested: { token: "abc", ok: 1, deeper: { secret: "x", fine: true } },
    list: [{ passwordHash: "x", id: 1 }, "plain"], when: new Date("2026-01-02T03:04:05Z"), huge: "x".repeat(1000),
  }) as Record<string, any>;
  assert.equal(out.password, undefined);
  assert.equal(out.nested.token, undefined);
  assert.equal(out.nested.ok, 1);
  assert.equal(out.nested.deeper.secret, undefined);
  assert.equal(out.nested.deeper.fine, true);
  assert.deepEqual(out.list, [{ id: 1 }, "plain"]);
  assert.equal(out.when, "2026-01-02T03:04:05.000Z");
  assert.ok(String(out.huge).length <= 301);
  assert.ok(!JSON.stringify(out).includes("hunter2"));
});

test("diffChanges only reports allow-listed, changed, non-sensitive fields", () => {
  const before = { status: "A", role: "X", passwordHash: "old", notes: "private", amount: "1.00" };
  const after = { status: "B", role: "X", passwordHash: "new", notes: "changed", amount: "2.00" };
  const changes = diffChanges(before, after, ["status", "role", "passwordHash", "amount"]);
  assert.deepEqual(changes, [{ field: "status", from: "A", to: "B" }, { field: "amount", from: "1.00", to: "2.00" }]);
  assert.deepEqual(diffChanges(null, { status: "B" }, ["status"]), [{ field: "status", from: null, to: "B" }]);
  assert.deepEqual(diffChanges({ d: new Date("2026-01-01T00:00:00Z") }, { d: new Date("2026-01-01T00:00:00Z") }, ["d"]), []);
});

test("values are reduced to scalars", () => {
  assert.equal(sanitizeValue({ a: 1 }), "[object omitted]");
  assert.equal(sanitizeValue(undefined), null);
  assert.equal(sanitizeValue(12), 12);
});
