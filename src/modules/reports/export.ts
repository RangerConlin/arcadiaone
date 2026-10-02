import { deflateRawSync } from "node:zlib";
import type { Cell, Column, ReportResult } from "./types";

/**
 * One export service for every report: reports only produce a ReportResult, and these functions
 * turn that into a file. Nothing here knows about any individual report.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * CSV formula-injection defense: a text cell that a spreadsheet could interpret as a formula
 * (starting with = + - @ tab or CR) gets a leading apostrophe, so it is displayed, not evaluated.
 * Genuine numeric values in number/money columns are left untouched so they stay numbers.
 */
export function csvSafe(value: Cell, column?: Column): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const numericColumn = column?.type === "money" || column?.type === "number";
  if (numericColumn && NUMERIC.test(text)) return text;
  return FORMULA_START.test(text) ? `'${text}` : text;
}

const csvEscape = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);

export function toCsv(result: ReportResult, meta: { title: string; filtersDescription?: string }): string {
  const lines: string[] = [];
  lines.push(csvEscape(csvSafe(meta.title)));
  if (meta.filtersDescription) lines.push(csvEscape(csvSafe(`Filters: ${meta.filtersDescription}`)));
  for (const note of result.notes ?? []) lines.push(csvEscape(csvSafe(note)));
  for (const item of result.summary ?? []) lines.push([csvEscape(csvSafe(item.label)), csvEscape(csvSafe(item.value, { label: "", type: item.money ? "money" : "number" }))].join(","));
  lines.push("");
  lines.push(result.columns.map((c) => csvEscape(csvSafe(c.label))).join(","));
  for (const row of result.rows) lines.push(row.map((cell, i) => csvEscape(csvSafe(cell, result.columns[i]))).join(","));
  // BOM so Excel opens UTF-8 correctly; CRLF per RFC 4180.
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------------------------
// Minimal XLSX writer (single sheet, inline strings) — no third-party dependency.
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const xmlEscape = (text: string) => text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const columnName = (index: number) => { let n = index, name = ""; do { name = String.fromCharCode(65 + (n % 26)) + name; n = Math.floor(n / 26) - 1; } while (n >= 0); return name; };

function cellXml(value: Cell, column: Column | undefined, ref: string, bold = false) {
  const style = bold ? ' s="1"' : "";
  if (value === null || value === undefined || value === "") return `<c r="${ref}"${style}/>`;
  const text = String(value);
  // Typed numeric columns are written as real numbers; everything else is an inline string, which
  // spreadsheets never evaluate as a formula.
  if ((column?.type === "money" || column?.type === "number") && NUMERIC.test(text)) return `<c r="${ref}"${style}><v>${text}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

export function toXlsx(result: ReportResult, meta: { title: string; filtersDescription?: string }): Buffer {
  const rows: string[] = [];
  let r = 1;
  const textRow = (text: string, bold = false) => rows.push(`<row r="${r++}">${cellXml(text, undefined, `A${r - 1}`, bold)}</row>`);
  textRow(meta.title, true);
  if (meta.filtersDescription) textRow(`Filters: ${meta.filtersDescription}`);
  for (const note of result.notes ?? []) textRow(note);
  for (const item of result.summary ?? []) rows.push(`<row r="${r++}">${cellXml(item.label, undefined, `A${r - 1}`)}${cellXml(item.value, { label: "", type: item.money ? "money" : "number" }, `B${r - 1}`)}</row>`);
  r += 1;
  rows.push(`<row r="${r}">${result.columns.map((c, i) => cellXml(c.label, undefined, `${columnName(i)}${r}`, true)).join("")}</row>`);
  r += 1;
  for (const row of result.rows) {
    rows.push(`<row r="${r}">${row.map((cell, i) => cellXml(cell, result.columns[i], `${columnName(i)}${r}`)).join("")}</row>`);
    r += 1;
  }
  const widths = result.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(12, c.label.length + 4))}" customWidth="1"/>`).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths}</cols><sheetData>${rows.join("")}</sheetData></worksheet>`;
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>` },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
  ].map((f) => ({ name: f.name, data: Buffer.from(f.data) }));
  return zip(files);
}

export const safeFilename = (base: string, extension: string, date: string) => `${base.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}-${date}.${extension}`;
