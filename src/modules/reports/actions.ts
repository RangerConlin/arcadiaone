"use server";

import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { filtersToQuery, parseReportFilters } from "./filters";
import { getReport } from "./registry";

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const MAX_SAVED_PER_REPORT = 20;

/** Saves a named filter set. Only whitelisted, validated filter values are ever persisted. */
export async function saveReportFilter(form: FormData) {
  const user = await requireAuthenticatedUser();
  const reportId = text(form, "reportId");
  const def = getReport(reportId);
  if (!def || !def.access(user)) redirect("/forbidden");
  const name = text(form, "name").slice(0, 60);
  const back = (query: string, extra: string) => redirect(`/reports/${reportId}?${[query, extra].filter(Boolean).join("&")}`);
  const params = Object.fromEntries(new URLSearchParams(text(form, "query")).entries());
  const filters = parseReportFilters(def, params);
  const query = filtersToQuery(filters);
  if (!name) return back(query, `error=${encodeURIComponent("Give the saved filter a name.")}`);
  const existing = await prisma.savedReportFilter.count({ where: { userId: user.id, reportId } });
  if (existing >= MAX_SAVED_PER_REPORT) return back(query, `error=${encodeURIComponent("You have reached the limit of saved filters for this report.")}`);
  await prisma.savedReportFilter.upsert({
    where: { userId_reportId_name: { userId: user.id, reportId, name } },
    create: { organizationId: user.organizationId, userId: user.id, reportId, name, filters },
    update: { filters },
  });
  return back(query, `success=${encodeURIComponent("Filters saved.")}`);
}

export async function deleteReportFilter(form: FormData) {
  const user = await requireAuthenticatedUser();
  const reportId = text(form, "reportId");
  await prisma.savedReportFilter.deleteMany({ where: { id: text(form, "id"), userId: user.id, organizationId: user.organizationId } });
  redirect(`/reports/${reportId}?success=${encodeURIComponent("Saved filter removed.")}`);
}
