/** Small RFC 4180 CSV reader used by the importer (the export side lives in modules/reports/export.ts). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;
const MAX_COLUMNS = 80;

export type ParsedCsv = { headers: string[]; rows: string[][]; delimiter: string };

export class CsvError extends Error {}

function detectDelimiter(firstLine: string) {
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![1] > 0 ? counts.sort((a, b) => b[1] - a[1])[0]![0] : ",";
}

export function parseCsv(input: string | Uint8Array): ParsedCsv {
  const bytes = typeof input === "string" ? null : input;
  if (bytes) {
    if (bytes.byteLength > MAX_IMPORT_BYTES) throw new CsvError(`The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB. Split it into smaller files.`);
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new CsvError("This looks like an Excel (.xlsx) workbook. Save it as CSV (UTF-8) and upload again.");
    if (bytes.includes(0)) throw new CsvError("The file is not a text CSV file.");
  }
  let text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: false }).decode(input);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) throw new CsvError("The file is empty.");

  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let touched = false;
  const endField = () => { row.push(field); field = ""; };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell.trim() !== "")) records.push(row);
    row = [];
    touched = false;
    if (records.length > MAX_IMPORT_ROWS + 1) throw new CsvError(`The file has more than ${MAX_IMPORT_ROWS.toLocaleString()} rows. Split it into smaller files.`);
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") { quoted = true; touched = true; }
    else if (char === delimiter) { endField(); touched = true; }
    else if (char === "\r") { if (text[i + 1] === "\n") i++; endRow(); }
    else if (char === "\n") endRow();
    else { field += char; touched = true; }
  }
  if (quoted) throw new CsvError("The file has an unterminated quoted value.");
  if (touched || field !== "" || row.length) endRow();

  const [headerRow, ...rows] = records;
  if (!headerRow) throw new CsvError("The file has no header row.");
  const headers = headerRow.map((header) => header.trim());
  if (headers.length > MAX_COLUMNS) throw new CsvError(`The file has more than ${MAX_COLUMNS} columns.`);
  if (headers.some((header) => !header)) throw new CsvError("Every column needs a header name; found an empty one.");
  const seen = new Set<string>();
  for (const header of headers) {
    const key = header.toLowerCase();
    if (seen.has(key)) throw new CsvError(`Duplicate column header “${header}”.`);
    seen.add(key);
  }
  // Short rows are padded; rows with extra cells keep them (they would be unmapped data, reported later).
  return { headers, rows: rows.map((cells) => (cells.length < headers.length ? [...cells, ...Array(headers.length - cells.length).fill("")] : cells)), delimiter };
}
