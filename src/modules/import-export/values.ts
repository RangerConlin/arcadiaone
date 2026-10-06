/** Strict value coercion for imports. Every function reports problems; nothing is silently dropped. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T,>(value: T): Parsed<T> => ({ ok: true, value });
const bad = (error: string): Parsed<never> => ({ ok: false, error });

export const clean = (value: string | undefined | null) => (value ?? "").replace(/ /g, " ").trim();

/** Accepts YYYY-MM-DD or M/D/YYYY (US order). Returns an ISO date string, or null for blank. */
export function parseDateCell(raw: string, label: string): Parsed<string | null> {
  const value = clean(raw);
  if (!value) return ok(null);
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) { y = +match[1]!; m = +match[2]!; d = +match[3]!; }
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value))) { m = +match[1]!; d = +match[2]!; y = +match[3]!; }
  else return bad(`${label}: “${value}” is not a valid date. Use YYYY-MM-DD.`);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 1900 || y > 2200) return bad(`${label}: “${value}” is not a real calendar date.`);
  return ok(date.toISOString().slice(0, 10));
}

export function parseEnumCell<T extends string>(raw: string, allowed: readonly T[], label: string, fallback?: T): Parsed<T | null> {
  const value = clean(raw);
  if (!value) return ok(fallback ?? null);
  const normalized = value.toUpperCase().replace(/[\s-]+/g, "_");
  const hit = allowed.find((candidate) => candidate === normalized);
  return hit ? ok(hit) : bad(`${label}: “${value}” is not valid. Allowed: ${allowed.map((a) => a.toLowerCase().replaceAll("_", " ")).join(", ")}.`);
}

export function parseBoolCell(raw: string, label: string, fallback: boolean): Parsed<boolean> {
  const value = clean(raw).toLowerCase();
  if (!value) return ok(fallback);
  if (["yes", "y", "true", "1", "on", "active"].includes(value)) return ok(true);
  if (["no", "n", "false", "0", "off", "inactive"].includes(value)) return ok(false);
  return bad(`${label}: “${clean(raw)}” must be yes or no.`);
}

export function parseDecimalCell(raw: string, label: string): Parsed<string | null> {
  const value = clean(raw).replace(/^\$/, "").replace(/,/g, "");
  if (!value) return ok(null);
  if (!/^\d+(\.\d{1,4})?$/.test(value)) return bad(`${label}: “${clean(raw)}” is not a valid non-negative amount.`);
  return ok(value);
}

export function parseIntCell(raw: string, label: string, min: number, max: number): Parsed<number | null> {
  const value = clean(raw);
  if (!value) return ok(null);
  if (!/^\d+$/.test(value)) return bad(`${label}: “${value}” must be a whole number.`);
  const n = Number(value);
  return n >= min && n <= max ? ok(n) : bad(`${label}: must be between ${min} and ${max}.`);
}

export const lower = (value: string | null | undefined) => clean(value).toLowerCase();
