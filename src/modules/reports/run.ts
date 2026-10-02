import type { AuthenticatedUser } from "@/lib/auth/session";
import { todayKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { parseReportFilters } from "./filters";
import { getReport } from "./registry";
import { EXPORT_ROW_LIMIT, REPORT_PAGE_SIZE, type ReportContext, type ReportDefinition, type ReportFilters, type ReportResult } from "./types";

type Params = Record<string, string | string[] | undefined>;

export type PreparedReport = { definition: ReportDefinition; filters: ReportFilters; ctx: ReportContext };

/** Resolves a report for a user, or null when it does not exist or the user may not run it. */
export async function prepareReport(user: AuthenticatedUser, id: string, params: Params, options: { export?: boolean; now?: Date; zone?: string } = {}): Promise<PreparedReport | null> {
  const definition = getReport(id);
  if (!definition || !definition.access(user)) return null;
  const filters = parseReportFilters(definition, params);
  const zone = options.zone ?? (await getViewerTimeZone(user));
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId }, select: { qualificationExpirationWarningDays: true } });
  const now = options.now ?? new Date();
  const page = Math.max(1, Number([params.page].flat()[0]) || 1);
  return {
    definition, filters,
    ctx: { user, filters, zone, now, today: todayKey(zone, now), page, pageSize: options.export ? null : REPORT_PAGE_SIZE, warningDays: organization.qualificationExpirationWarningDays },
  };
}

export async function runPrepared(prepared: PreparedReport): Promise<ReportResult> {
  const result = await prepared.definition.run(prepared.ctx);
  if (prepared.ctx.pageSize === null && result.rows.length >= EXPORT_ROW_LIMIT) {
    return { ...result, notes: [...(result.notes ?? []), `Export limited to the first ${EXPORT_ROW_LIMIT} rows. Narrow the filters to export the rest.`] };
  }
  return result;
}
