import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { dateKeyInZone } from "@/lib/datetime";
import { safeFilename, toCsv, toXlsx } from "@/modules/reports/export";
import { filtersToQuery } from "@/modules/reports/filters";
import { prepareReport, runPrepared } from "@/modules/reports/run";

export const dynamic = "force-dynamic";

/**
 * Exports re-run the report from scratch with the caller's own session: the report's access rule
 * and row-level scope apply exactly as on screen, filters are re-validated, and nothing about the
 * result comes from the client except those validated filters.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user || user.mustChangePassword) return new NextResponse("Authentication required.", { status: 401 });
  const { id } = await params;
  const query = Object.fromEntries(request.nextUrl.searchParams.entries());
  const prepared = await prepareReport(user, id, query, { export: true });
  if (!prepared) return new NextResponse("Report not found.", { status: 404 });
  const format = request.nextUrl.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const result = await runPrepared(prepared);
  const meta = { title: prepared.definition.title, filtersDescription: filtersToQuery(prepared.filters).replaceAll("&", ", ") || "none" };
  const stamp = dateKeyInZone(prepared.ctx.now, prepared.ctx.zone);
  const headers = {
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `attachment; filename="${safeFilename(prepared.definition.id, format, stamp)}"`,
  };
  if (format === "xlsx") {
    return new NextResponse(new Uint8Array(toXlsx(result, meta)), { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
  }
  return new NextResponse(toCsv(result, meta), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" } });
}
