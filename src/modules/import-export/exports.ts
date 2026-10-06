import type { AuthenticatedUser } from "@/lib/auth/session";
import { getReport } from "@/modules/reports/registry";

/**
 * Data exports are the existing curated reports. Each entry points at a report, so the report's own
 * access rule, row-level scope, filter validation, row cap, CSV formula protection and audit record
 * apply unchanged. There is deliberately no generic "export everything" endpoint.
 */
export const DATA_EXPORTS = [
  { entity: "Employees", reportId: "employee-directory", note: "Directory fields only; no password hashes, personal contact details or notes." },
  { entity: "Qualifications", reportId: "qualification-status", note: "" },
  { entity: "Projects", reportId: "project-summary", note: "" },
  { entity: "Tasks", reportId: "open-tasks", note: "Open tasks; the completed and overdue task reports are in Reports." },
  { entity: "Clients", reportId: "client-directory", note: "" },
  { entity: "Equipment", reportId: "equipment-inventory", note: "" },
  { entity: "Rentals", reportId: "rental-activity", note: "" },
  { entity: "Invoices", reportId: "invoice-register", note: "All statuses; filter by status or issue date." },
  { entity: "Ledger", reportId: "ledger-activity", note: "" },
  { entity: "Training", reportId: "training-history", note: "" },
  { entity: "Maintenance", reportId: "maintenance-history", note: "" },
] as const;

/** Only exports whose report the viewer may run. */
export function exportsFor(user: AuthenticatedUser) {
  return DATA_EXPORTS.flatMap((entry) => {
    const report = getReport(entry.reportId);
    return report && report.access(user) ? [{ ...entry, title: report.title }] : [];
  });
}
