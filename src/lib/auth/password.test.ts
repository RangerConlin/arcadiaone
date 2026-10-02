import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, validatePassword, verifyPassword } from "./password";

test("password hashes are salted and verify only the original password", async () => {
  const password = "a sufficiently long passphrase";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("incorrect passphrase", first), false);
  assert.equal(first.includes(password), false);
});

test("password policy permits passphrases and rejects short values", () => {
  assert.equal(validatePassword("long words make good passphrases"), null);
  assert.match(validatePassword("too short") || "", /at least 12/);
});
