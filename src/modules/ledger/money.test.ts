import assert from "node:assert/strict";
import test from "node:test";
import { formatDecimal, parseMoney, sum } from "./money";

test("parses exact two-decimal amounts and rejects the rest", () => {
  assert.equal(parseMoney("1,250.50")?.toFixed(2), "1250.50");
  assert.equal(parseMoney("-12.5")?.toFixed(2), "-12.50");
  for (const bad of ["", "abc", "1.234", "1e5", "--1", "1.", ".5", "1234567890123", "NaN", "Infinity"]) assert.equal(parseMoney(bad), null, bad);
});

test("decimal arithmetic has no floating point drift", () => {
  assert.notEqual(0.1 + 0.2, 0.3); // the JavaScript problem we avoid
  assert.equal(sum(["0.10", "0.20"]).toFixed(2), "0.30");
  assert.equal(sum(Array.from({ length: 1000 }, () => "0.10")).toFixed(2), "100.00");
  assert.equal(sum(["12345678901.11", "0.89"]).toFixed(2), "12345678902.00");
});

test("formatting groups thousands and keeps two decimals", () => {
  assert.equal(formatDecimal("1234567.5"), "1,234,567.50");
  assert.equal(formatDecimal("-0.5"), "-0.50");
  assert.equal(formatDecimal(null), "0.00");
});
