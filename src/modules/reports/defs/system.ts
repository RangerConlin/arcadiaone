import { addDays, startOfDayUtc } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { pageRows, rangeOrDefault } from "../helpers";
import type { ReportDefinition } from "../types";

const adminOnly = (user: { role: string }) => user.role === "ADMIN";

const auditSummary: ReportDefinition = {
  id: "audit-activity-summary", category: "system", title: "Audit activity summary",
  description: "How many audited events occurred per action in a date range (default: last 30 days). Open the audit log for individual events.",
  filters: ["dateRange"], access: adminOnly,
  async run(ctx) {
    const range = rangeOrDefault(ctx, 30);
    const groups = await prisma.auditEvent.groupBy({
      by: ["action", "outcome"],
      where: { organizationId: ctx.user.organizationId, occurredAt: { gte: startOfDayUtc(range.from, ctx.zone), lt: startOfDayUtc(addDays(range.to, 1), ctx.zone) } },
      _count: { _all: true },
    });
    const actions = [...new Set(groups.map((g) => g.action))].sort();
    const rows = actions.map((action) => {
      const mine = groups.filter((g) => g.action === action);
      return [action, mine.reduce((n, g) => n + g._count._all, 0), mine.filter((g) => g.outcome === "FAILURE").reduce((n, g) => n + g._count._all, 0)];
    });
    return {
      total: rows.length, notes: [`Events from ${range.from} to ${range.to}.`],
      summary: [{ label: "Events", value: String(rows.reduce((n, r) => n + (r[1] as number), 0)) }],
      columns: [{ label: "Action" }, { label: "Events", type: "number" }, { label: "Failures", type: "number" }], rows: pageRows(ctx, rows),
    };
  },
};

export const systemReports = [auditSummary];
