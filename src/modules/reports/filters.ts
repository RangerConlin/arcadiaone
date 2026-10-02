import { isDayKey } from "@/lib/datetime";
import type { FilterKey, ReportDefinition, ReportFilters } from "./types";

type Params = Record<string, string | string[] | undefined>;
const one = (params: Params, key: string) => { const v = params[key]; return (Array.isArray(v) ? v[0] : v)?.trim() || undefined; };
const id = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

/**
 * Parses only the filters a report declares. Values are shape-validated here and then applied by
 * the report as database predicates on top of the viewer's own visibility scope, so a crafted URL
 * can narrow results but never widen them.
 */
export function parseReportFilters(def: Pick<ReportDefinition, "filters" | "statusOptions">, params: Params): ReportFilters {
  const wants = (key: FilterKey) => def.filters.includes(key);
  const filters: ReportFilters = {};
  if (wants("dateRange")) {
    const from = one(params, "from"), to = one(params, "to");
    if (isDayKey(from)) filters.from = from;
    if (isDayKey(to)) filters.to = to;
  }
  if (wants("department")) filters.department = id(one(params, "department"));
  if (wants("position")) filters.position = id(one(params, "position"));
  if (wants("employee")) filters.employee = id(one(params, "employee"));
  if (wants("project")) filters.project = id(one(params, "project"));
  if (wants("client")) filters.client = id(one(params, "client"));
  if (wants("qualificationType")) filters.qualificationType = id(one(params, "qualificationType"));
  if (wants("status")) {
    const status = one(params, "status");
    if (status && def.statusOptions?.some((option) => option.value === status)) filters.status = status;
  }
  if (wants("days")) {
    const days = Number(one(params, "days"));
    if (Number.isInteger(days) && days >= 1 && days <= 730) filters.days = days;
  }
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)) as ReportFilters;
}

/** Stable query string for links, saved filters and exports. */
export function filtersToQuery(filters: ReportFilters, extra: Record<string, string | undefined> = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") query.set(key, String(value));
  for (const [key, value] of Object.entries(extra)) if (value) query.set(key, value);
  return query.toString();
}

export const hasFilters = (filters: ReportFilters) => Object.values(filters).some((value) => value !== undefined && value !== "");
