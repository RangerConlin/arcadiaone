import { ENTITY_DEFS } from "./entities";
import type { EntityDef, ImportEntity } from "./types";

export type Staged = { headers: string[]; rows: string[][] };
export type Mapping = Record<string, string | null>;

const normalize = (value: string) => value.toLowerCase().replace(/#/g, " number ").replace(/[^a-z0-9]+/g, "");

/** Suggests a source column for every target field: exact key/label first, then known aliases. Each column is used once. */
export function suggestMapping(entity: ImportEntity, headers: string[]): Mapping {
  const def = ENTITY_DEFS[entity] as EntityDef;
  const taken = new Set<string>();
  const byNorm = new Map(headers.map((header) => [normalize(header), header]));
  const mapping: Mapping = Object.fromEntries(def.fields.map((field) => [field.key, null]));
  const pass = (candidatesOf: (field: EntityDef["fields"][number]) => string[]) => {
    for (const field of def.fields) {
      if (mapping[field.key]) continue;
      const hit = candidatesOf(field).map((c) => byNorm.get(normalize(c))).find((header) => header && !taken.has(header));
      if (hit) { mapping[field.key] = hit; taken.add(hit); }
    }
  };
  pass((field) => [field.key, field.label]);
  pass((field) => field.aliases ?? []);
  return mapping;
}

/** Validates a mapping submitted by the browser: only known fields, only real headers, no column used twice. */
export function cleanMapping(entity: ImportEntity, headers: string[], submitted: Record<string, unknown>): { mapping: Mapping; error?: string } {
  const def = ENTITY_DEFS[entity] as EntityDef;
  const mapping: Mapping = {};
  const used = new Set<string>();
  for (const field of def.fields) {
    const raw = typeof submitted[field.key] === "string" ? (submitted[field.key] as string) : "";
    if (!raw) { mapping[field.key] = null; continue; }
    if (!headers.includes(raw)) return { mapping, error: `“${raw}” is not a column in the uploaded file.` };
    if (used.has(raw)) return { mapping, error: `Column “${raw}” is mapped to more than one field.` };
    used.add(raw);
    mapping[field.key] = raw;
  }
  const missing = def.fields.filter((f) => f.required && !mapping[f.key]);
  if (missing.length) return { mapping, error: `Map a column for: ${missing.map((f) => f.label).join(", ")}.` };
  return { mapping };
}
