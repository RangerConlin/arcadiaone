import type { AuthenticatedUser } from "@/lib/auth/session";

export const REPORT_CATEGORIES = [
  { id: "people", label: "People" },
  { id: "qualifications", label: "Qualifications" },
  { id: "projects", label: "Projects" },
  { id: "tasks", label: "Tasks" },
  { id: "clients", label: "Clients" },
  { id: "rentals", label: "Rentals and equipment" },
  { id: "financial", label: "Invoices and financial" },
  { id: "system", label: "System and audit" },
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]["id"];

export type ColumnType = "text" | "money" | "number" | "status";
export type Column = { label: string; type?: ColumnType };
/** Dates are pre-formatted strings (YYYY-MM-DD or YYYY-MM-DD HH:mm in the viewer's zone); money is an exact decimal string. */
export type Cell = string | number | null;

export type SummaryItem = { label: string; value: string; money?: boolean };
export type ReportResult = {
  columns: Column[];
  rows: Cell[][];
  /** Rows matching the filters across all pages (for list reports) or rows returned (aggregate reports). */
  total: number;
  summary?: SummaryItem[];
  notes?: string[];
};

export const FILTER_KEYS = ["dateRange", "department", "position", "employee", "project", "client", "status", "qualificationType", "days"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export type ReportFilters = {
  from?: string; to?: string; department?: string; position?: string; employee?: string; project?: string; client?: string;
  status?: string; qualificationType?: string; days?: number;
};

export type ReportContext = {
  user: AuthenticatedUser;
  filters: ReportFilters;
  zone: string;
  now: Date;
  /** Viewer-zone calendar day, `YYYY-MM-DD`. */
  today: string;
  page: number;
  /** Rows per page, or null when generating an export (capped by EXPORT_ROW_LIMIT). */
  pageSize: number | null;
  warningDays: number;
};

export type ReportDefinition = {
  id: string;
  category: ReportCategory;
  title: string;
  description: string;
  filters: FilterKey[];
  /** Allowed values for the `status` filter, with labels. */
  statusOptions?: Array<{ value: string; label: string }>;
  /** Plain-language definition of what the numbers mean. Shown on the report and in exports. */
  definition?: string;
  access: (user: AuthenticatedUser) => boolean;
  run: (ctx: ReportContext) => Promise<ReportResult>;
};

export const REPORT_PAGE_SIZE = 50;
export const EXPORT_ROW_LIMIT = 50_000;
