import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { csvSafe, toCsv, toXlsx } from "./export";
import { agingBucket } from "./defs/finance";
import type { ReportResult } from "./types";

test("formula-like text is neutralized, numbers are not", () => {
  for (const evil of ["=SUM(A1:A9)", "+1+1", "-2+3", "@cmd", "\tTAB", "\rCR", "=HYPERLINK(\"http://x\")"]) assert.equal(csvSafe(evil), `'${evil}`, evil);
  assert.equal(csvSafe("Normal text"), "Normal text");
  assert.equal(csvSafe("2026-10-02"), "2026-10-02");
  assert.equal(csvSafe("-12.50", { label: "Amount", type: "money" }), "-12.50");
  assert.equal(csvSafe("-12.50x", { label: "Amount", type: "money" }), "'-12.50x");
  assert.equal(csvSafe(null), "");
});

const sample: ReportResult = {
  total: 2,
  columns: [{ label: "Name" }, { label: "Amount", type: "money" }],
  rows: [["=cmd|' /C calc'!A0", "10.00"], ['He said "hi", then left', "-5.25"]],
  summary: [{ label: "Total", value: "4.75", money: true }],
  notes: ["Operational reporting"],
};

test("csv quotes, escapes and protects every cell", () => {
  const csv = toCsv(sample, { title: "=Evil title", filtersDescription: "none" });
  const lines = csv.replace("﻿", "").split("\r\n");
  assert.equal(lines[0], "'=Evil title");
  assert.ok(lines.includes("Name,Amount"));
  assert.ok(lines.includes(`'=cmd|' /C calc'!A0,10.00`));
  assert.ok(lines.includes(`"He said ""hi"", then left",-5.25`));
  assert.ok(csv.startsWith("﻿"));
});

test("xlsx is a valid zip with the expected parts and escaped content", () => {
  const buffer = toXlsx(sample, { title: "T & <Co>" });
  assert.equal(buffer.readUInt32LE(0), 0x04034b50);
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50);
  const entries = buffer.readUInt16LE(buffer.length - 22 + 10);
  assert.equal(entries, 6);
  // Locate the sheet entry and inflate it.
  let offset = 0, sheet = "";
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18), nameLength = buffer.readUInt16LE(offset + 26);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString();
    const data = buffer.subarray(offset + 30 + nameLength, offset + 30 + nameLength + compressedSize);
    if (name === "xl/worksheets/sheet1.xml") sheet = inflateRawSync(data).toString();
    offset += 30 + nameLength + compressedSize;
  }
  assert.ok(sheet.includes("T &amp; &lt;Co&gt;"));
  assert.ok(sheet.includes("<v>10.00</v>") && sheet.includes("<v>-5.25</v>"));
  assert.ok(sheet.includes("inlineStr"), "text is stored as inline strings, never formulas");
  assert.ok(!sheet.includes("<f>"));
});

test("invoice aging buckets", () => {
  assert.deepEqual([-5, 0, 1, 30, 31, 60, 61, 90, 91, 400].map(agingBucket), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
});
