/**
 * Central audit sanitization. Audit metadata is built from allow-listed fields only; this
 * module is the second line of defense: anything that looks like a secret is dropped, free
 * text is truncated, and structured values are flattened to short scalars.
 */

const SENSITIVE_KEY =
  /pass(word|phrase)?|hash|token|secret|api[-_]?key|authori[sz]ation|cookie|session|storage[-_]?key|checksum|credential|private[-_]?key|signature[-_]?data|ssn|otp/i;

export const MAX_VALUE_LENGTH = 300;
const MAX_KEYS = 40;
const MAX_DEPTH = 3;

export const isSensitiveKey = (key: string) => SENSITIVE_KEY.test(key);

export type AuditScalar = string | number | boolean | null;
export type AuditChange = { field: string; from: AuditScalar; to: AuditScalar };

/** Reduces any value to a short, JSON-safe scalar. Objects and arrays are never stored whole. */
export function sanitizeValue(value: unknown): AuditScalar {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "boolean" || typeof value === "number") return Number.isFinite(value as number) || typeof value === "boolean" ? (value as number | boolean) : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}…` : value;
  // Prisma.Decimal and similar value objects expose a decimal string.
  if (typeof value === "object" && typeof (value as { toFixed?: unknown }).toFixed === "function") return String((value as { toString(): string }).toString());
  return "[object omitted]";
}

/** Recursively strips sensitive keys and caps size/depth. */
export function sanitizeMetadata(input: unknown, depth = 0): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (count >= MAX_KEYS) break;
    if (isSensitiveKey(key)) continue;
    if (Array.isArray(value)) {
      result[key] = value.slice(0, 20).map((item) => (item && typeof item === "object" && !(item instanceof Date) ? sanitizeMetadata(item, depth + 1) : sanitizeValue(item)));
    } else if (value && typeof value === "object" && !(value instanceof Date) && typeof (value as { toFixed?: unknown }).toFixed !== "function") {
      if (depth < MAX_DEPTH) result[key] = sanitizeMetadata(value, depth + 1);
    } else {
      result[key] = sanitizeValue(value);
    }
    count += 1;
  }
  return result;
}

const same = (a: AuditScalar, b: AuditScalar) => a === b;

/**
 * Builds a field-level change set from before/after snapshots, restricted to an explicit
 * allow-list of fields (so new columns are never logged by accident) and never including
 * sensitive keys even if someone allow-lists one by mistake.
 */
export function diffChanges(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>, fields: readonly string[]): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const field of fields) {
    if (isSensitiveKey(field)) continue;
    const from = sanitizeValue(before?.[field]);
    const to = sanitizeValue(after[field]);
    if (!same(from, to)) changes.push({ field, from, to });
  }
  return changes;
}
