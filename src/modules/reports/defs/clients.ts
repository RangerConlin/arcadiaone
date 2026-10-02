import type { Prisma } from "@/generated/prisma/client";
import { keyToDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { clientVisibilityWhere } from "@/modules/clients/authorization";
import { invoiceVisibilityWhere } from "@/modules/invoices/authorization";
import { ZERO, plainDecimal } from "@/modules/ledger/money";
import { projectVisibilityWhere } from "@/modules/projects/authorization";
import { dateCell, instantCell, label, OPEN_INVOICE_STATUSES, pageRows, rangeOrDefault, window } from "../helpers";
import type { ReportContext, ReportDefinition } from "../types";

const everyone = () => true;
const financial = (user: { role: string }) => user.role === "ADMIN" || user.role === "MANAGER";
const CLIENT_STATUSES = ["PROSPECT", "ACTIVE", "INACTIVE", "ARCHIVED"].map((value) => ({ value, label: value.toLowerCase() }));

function clientWhere(ctx: ReportContext): Prisma.ClientWhereInput {
  const and: Prisma.ClientWhereInput[] = [clientVisibilityWhere(ctx.user)];
  if (ctx.filters.client) and.push({ id: ctx.filters.client });
  if (ctx.filters.status) and.push({ status: ctx.filters.status as never });
  return { AND: and };
}

const directory: ReportDefinition = {
  id: "client-directory", category: "clients", title: "Client directory",
  description: "Clients you can access with status, primary contact and project counts.",
  filters: ["client", "status"], statusOptions: CLIENT_STATUSES, access: everyone,
  async run(ctx) {
    const where = clientWhere(ctx);
    const [rows, total] = await prisma.$transaction([
      prisma.client.findMany({
        where, orderBy: [{ name: "asc" }, { id: "asc" }], ...window(ctx),
        include: { primaryContact: true, _count: { select: { projects: { where: { status: "ACTIVE" } } } } },
      }),
      prisma.client.count({ where }),
    ]);
    return {
      total,
      columns: [{ label: "Client" }, { label: "Client #" }, { label: "Status", type: "status" }, { label: "Type", type: "status" }, { label: "Primary contact" }, { label: "Phone" }, { label: "Email" }, { label: "Active projects", type: "number" }],
      rows: rows.map((c) => [c.displayName || c.name, c.clientNumber, label(c.status), label(c.type), c.primaryContact ? `${c.primaryContact.firstName} ${c.primaryContact.lastName}` : null, c.mainPhone, c.generalEmail, c._count.projects]),
    };
  },
};

const activeProjects: ReportDefinition = {
  id: "active-projects-by-client", category: "clients", title: "Active projects by client",
  description: "Planning, active and on-hold project counts per client, with the next target end date.",
  filters: ["client"], access: everyone,
  definition: "Only projects you can see are counted. Completed, cancelled and archived projects are excluded.",
  async run(ctx) {
    const groups = await prisma.project.groupBy({
      by: ["clientId", "status"], _count: { _all: true }, _min: { targetEndDate: true },
      where: { AND: [projectVisibilityWhere(ctx.user), { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] }, clientId: ctx.filters.client ?? { not: null } }] },
    });
    const clients = await prisma.client.findMany({ where: { id: { in: [...new Set(groups.map((g) => g.clientId!))] }, organizationId: ctx.user.organizationId }, select: { id: true, name: true } });
    const nameOf = new Map(clients.map((c) => [c.id, c.name]));
    const rows = clients.map((c) => {
      const mine = groups.filter((g) => g.clientId === c.id);
      const count = (status: string) => mine.find((g) => g.status === status)?._count._all ?? 0;
      const next = mine.map((g) => g._min.targetEndDate).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0];
      return [nameOf.get(c.id)!, count("ACTIVE"), count("PLANNING"), count("ON_HOLD"), dateCell(next)] as [string, number, number, number, string | null];
    }).sort((a, b) => a[0].localeCompare(b[0]));
    return { total: rows.length, columns: [{ label: "Client" }, { label: "Active", type: "number" }, { label: "Planning", type: "number" }, { label: "On hold", type: "number" }, { label: "Earliest target end" }], rows: pageRows(ctx, rows) };
  },
};

const outstanding: ReportDefinition = {
  id: "outstanding-invoices-by-client", category: "clients", title: "Outstanding invoices by client",
  description: "Unpaid balance per client, with the overdue portion.",
  filters: ["client"], access: financial,
  definition: "Open invoices (issued, sent or partially paid) with a balance. Overdue = due date before today. Totals are per currency and are never mixed. Drafts and voided invoices are excluded. This is operational reporting, not an accounting statement.",
  async run(ctx) {
    const today = keyToDate(ctx.today);
    const base: Prisma.InvoiceWhereInput = { AND: [invoiceVisibilityWhere(ctx.user), { status: { in: [...OPEN_INVOICE_STATUSES] }, balanceDue: { gt: 0 }, ...(ctx.filters.client ? { clientId: ctx.filters.client } : {}) }] };
    const [open, overdue] = await Promise.all([
      prisma.invoice.groupBy({ by: ["clientId", "currency"], where: base, _sum: { balanceDue: true }, _count: { _all: true } }),
      prisma.invoice.groupBy({ by: ["clientId", "currency"], where: { AND: [base, { dueDate: { lt: today } }] }, _sum: { balanceDue: true } }),
    ]);
    const clients = await prisma.client.findMany({ where: { id: { in: open.map((g) => g.clientId) }, organizationId: ctx.user.organizationId }, select: { id: true, name: true } });
    const nameOf = new Map(clients.map((c) => [c.id, c.name]));
    const rows = open.map((g) => [nameOf.get(g.clientId) ?? "Unknown", g.currency, g._count._all, plainDecimal(g._sum.balanceDue), plainDecimal(overdue.find((o) => o.clientId === g.clientId && o.currency === g.currency)?._sum.balanceDue ?? ZERO)] as [string, string, number, string, string]).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    return { total: rows.length, columns: [{ label: "Client" }, { label: "Currency" }, { label: "Open invoices", type: "number" }, { label: "Balance due", type: "money" }, { label: "Of which overdue", type: "money" }], rows: pageRows(ctx, rows) };
  },
};

const recentActivity: ReportDefinition = {
  id: "client-recent-activity", category: "clients", title: "Client recent activity",
  description: "Relationship activity logged against clients (calls, meetings, notes) in a date range (default: last 30 days).",
  filters: ["dateRange", "client"], access: everyone,
  async run(ctx) {
    const range = rangeOrDefault(ctx, 30);
    const where: Prisma.ClientActivityWhereInput = { organizationId: ctx.user.organizationId, client: clientWhere(ctx), occurredAt: { gte: range.fromDate, lt: range.toExclusive } };
    const [rows, total] = await prisma.$transaction([
      prisma.clientActivity.findMany({ where, include: { client: { select: { name: true } }, user: { select: { email: true } } }, orderBy: [{ occurredAt: "desc" }, { id: "asc" }], ...window(ctx) }),
      prisma.clientActivity.count({ where }),
    ]);
    return {
      total, notes: [`Activity from ${range.from} to ${range.to}.`],
      columns: [{ label: "When" }, { label: "Client" }, { label: "Type", type: "status" }, { label: "Summary" }, { label: "Recorded by" }],
      rows: rows.map((a) => [instantCell(a.occurredAt, ctx.zone), a.client.name, label(a.activityType), a.summary, a.user.email]),
    };
  },
};

export const clientReports = [directory, activeProjects, outstanding, recentActivity];
