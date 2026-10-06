import assert from "node:assert/strict";
import test from "node:test";
import { CsvError, parseCsv } from "./csv";
import { ENTITY_DEFS } from "./entities";
import { cleanMapping, suggestMapping } from "./mapping";
import { IMPORT_ENTITIES } from "./types";
import { parseBoolCell, parseDateCell, parseDecimalCell, parseEnumCell, parseIntCell } from "./values";
import { formatNumber, PREFIX_PATTERN } from "../settings/numbering";
import { defaultsSchema, identitySchema, thresholdsSchema } from "../settings/validation";

test("CSV: quotes, embedded commas/newlines, BOM, CRLF and blank lines", () => {
  const parsed = parseCsv('﻿First Name,Notes\r\n"Ann ""A""","line1\nline2, more"\r\n\r\nBob,\r\n');
  assert.deepEqual(parsed.headers, ["First Name", "Notes"]);
  assert.deepEqual(parsed.rows, [['Ann "A"', "line1\nline2, more"], ["Bob", ""]]);
});

test("CSV: semicolon delimiter, short rows padded, final line without newline", () => {
  const parsed = parseCsv("a;b;c\n1;2\n3;4;5");
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.rows, [["1", "2", ""], ["3", "4", "5"]]);
});

test("CSV: rejects empty, duplicate headers, unterminated quotes, binary and xlsx uploads", () => {
  assert.throws(() => parseCsv("   "), CsvError);
  assert.throws(() => parseCsv("a,a\n1,2"), /Duplicate column/);
  assert.throws(() => parseCsv('a,b\n"1,2'), /unterminated/);
  assert.throws(() => parseCsv(new Uint8Array([0x50, 0x4b, 3, 4])), /Excel/);
  assert.throws(() => parseCsv(new Uint8Array([97, 44, 0, 10])), /not a text/);
  assert.throws(() => parseCsv("a,,c\n1,2,3"), /empty one/);
});

test("values: dates are strict, enums and booleans report instead of dropping", () => {
  assert.deepEqual(parseDateCell("2026-02-28", "d"), { ok: true, value: "2026-02-28" });
  assert.deepEqual(parseDateCell("3/7/2026", "d"), { ok: true, value: "2026-03-07" });
  assert.equal(parseDateCell("2026-02-30", "d").ok, false);
  assert.equal(parseDateCell("31/12/2026", "d").ok, false);
  assert.equal(parseDateCell("yesterday", "d").ok, false);
  assert.deepEqual(parseDateCell("", "d"), { ok: true, value: null });
  assert.deepEqual(parseEnumCell("on hold", ["ACTIVE", "ON_HOLD"], "s"), { ok: true, value: "ON_HOLD" });
  assert.equal(parseEnumCell("paused", ["ACTIVE", "ON_HOLD"], "s").ok, false);
  assert.deepEqual(parseEnumCell("", ["ACTIVE"], "s", "ACTIVE"), { ok: true, value: "ACTIVE" });
  assert.deepEqual(parseBoolCell("Yes", "b", false), { ok: true, value: true });
  assert.equal(parseBoolCell("maybe", "b", false).ok, false);
  assert.deepEqual(parseDecimalCell("$1,234.50", "m"), { ok: true, value: "1234.50" });
  assert.equal(parseDecimalCell("-5", "m").ok, false);
  assert.equal(parseIntCell("12x", "n", 1, 99).ok, false);
});

test("mapping suggests tolerant matches and never reuses a column", () => {
  const mapping = suggestMapping("employees", ["First Name", "Last Name", "Employee ID", "Email", "Job Title", "Cell Phone", "Hire Date", "Mystery"]);
  assert.equal(mapping.firstName, "First Name");
  assert.equal(mapping.lastName, "Last Name");
  assert.equal(mapping.employeeNumber, "Employee ID");
  assert.equal(mapping.workEmail, "Email");
  assert.equal(mapping.position, "Job Title");
  assert.equal(mapping.mobilePhone, "Cell Phone");
  assert.equal(mapping.hireDate, "Hire Date");
  assert.equal(suggestMapping("clients", ["Client", "Phone", "Email"]).name, "Client");
});

test("mapping validation: unknown column, duplicate column and missing required field are refused", () => {
  const headers = ["a", "b"];
  assert.match(cleanMapping("departments", headers, { name: "zzz" }).error ?? "", /not a column/);
  assert.match(cleanMapping("employees", headers, { firstName: "a", lastName: "a" }).error ?? "", /more than one/);
  assert.match(cleanMapping("employees", headers, { firstName: "a" }).error ?? "", /Last name/);
  assert.equal(cleanMapping("employees", headers, { firstName: "a", lastName: "b" }).error, undefined);
});

test("templates: every import type has labelled fields, an example per field and no real-looking data", () => {
  for (const key of IMPORT_ENTITIES) {
    const def = ENTITY_DEFS[key];
    assert.ok(def.fields.length >= 3, key);
    assert.ok(def.guidance.length >= 1, key);
    for (const field of def.fields) assert.ok(field.label && field.help, `${key}.${field.key}`);
    for (const field of def.fields) assert.ok(!/@(?!example\.com)/.test(field.example), `${key}.${field.key} example uses a real domain`);
  }
});

test("update mode is offered only where identification is unambiguous", () => {
  const updatable = IMPORT_ENTITIES.filter((key) => ENTITY_DEFS[key].updateIdentity);
  assert.deepEqual([...updatable].sort(), ["clients", "employees", "equipment"]);
});

test("numbering formats and prefix rules", () => {
  assert.equal(formatNumber("P-", 7, 4), "P-0007");
  assert.equal(formatNumber("", 12, 4), "0012");
  for (const ok of ["", "P-", "PRJ/26-", "A.B_C"]) assert.ok(PREFIX_PATTERN.test(ok), ok);
  for (const bad of ["-X", "has space", "x".repeat(13), "a;b", "<b>"]) assert.ok(!PREFIX_PATTERN.test(bad), bad);
});

test("settings validation", () => {
  assert.equal(identitySchema.safeParse({ displayName: "Acme", timezone: "America/Chicago", defaultCurrency: "usd", website: "https://acme.test", generalEmail: "", legalName: "", billingAddress: "", phone: "" }).success, true);
  assert.equal(identitySchema.safeParse({ displayName: "Acme", timezone: "Mars/Base", defaultCurrency: "USD" }).success, false);
  assert.equal(identitySchema.safeParse({ displayName: "Acme", timezone: "UTC", defaultCurrency: "DOLLARS" }).success, false);
  assert.equal(identitySchema.safeParse({ displayName: "Acme", timezone: "UTC", defaultCurrency: "USD", website: "javascript:alert(1)" }).success, false);
  assert.equal(identitySchema.safeParse({ displayName: "", timezone: "UTC", defaultCurrency: "USD" }).success, false);
  const ok = { qualificationExpirationWarningDays: "45", taskDueSoonDays: "5", rentalDueSoonDays: "2", invoiceDueSoonDays: "10", maintenanceDueSoonDays: "21" };
  assert.equal(thresholdsSchema.safeParse(ok).success, true);
  assert.equal(thresholdsSchema.safeParse({ ...ok, taskDueSoonDays: "0" }).success, false);
  assert.equal(thresholdsSchema.safeParse({ ...ok, maintenanceDueSoonDays: "999" }).success, false);
  assert.equal(thresholdsSchema.safeParse({ ...ok, invoiceDueSoonDays: "abc" }).success, false);
  assert.equal(defaultsSchema.safeParse({ invoiceDefaultDueDays: "", defaultRentalTerms: "", defaultPaymentTerms: "Net 30", invoiceDefaultTerms: "", invoiceFooter: "" }).success, true);
  assert.equal(defaultsSchema.safeParse({ invoiceDefaultDueDays: "-1" }).success, false);
});
