import type { AuthenticatedUser } from "@/lib/auth/session";
import { clientReports } from "./defs/clients";
import { financeReports } from "./defs/finance";
import { peopleReports } from "./defs/people";
import { rentalReports } from "./defs/rentals";
import { systemReports } from "./defs/system";
import { workReports } from "./defs/work";
import { REPORT_CATEGORIES, type ReportDefinition } from "./types";

export const ALL_REPORTS: ReportDefinition[] = [...peopleReports, ...workReports, ...clientReports, ...rentalReports, ...financeReports, ...systemReports];
const BY_ID = new Map(ALL_REPORTS.map((report) => [report.id, report]));

export const getReport = (id: string) => BY_ID.get(id);

/** Only reports the user may run are ever listed or runnable. Each report also scopes its own rows. */
export function reportsFor(user: AuthenticatedUser) {
  return REPORT_CATEGORIES.map((category) => ({ ...category, reports: ALL_REPORTS.filter((r) => r.category === category.id && r.access(user)) })).filter((c) => c.reports.length);
}
