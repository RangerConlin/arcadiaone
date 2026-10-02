import type { Prisma } from "@/generated/prisma/client";
import { Prisma as P } from "@/generated/prisma/client";
import { dateKeyUtc, diffDays } from "@/lib/datetime";
import { formatName } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getMaintenancePolicy } from "@/modules/maintenance/authorization";
import { loadDueItems } from "@/modules/maintenance/data";
import { findRentalConflicts } from "@/modules/maintenance/rental-conflicts";
import { TYPE_LABELS } from "@/modules/maintenance/validation";
import { dateCell, instantCell, label, pageRows, rangeOrDefault, window } from "../helpers";
import type { Cell, ReportContext, ReportDefinition } from "../types";

const everyone = () => true;
// Costs are financial: cost reports and cost columns are for administrators and managers only.
const staffOnly = (user: { role: string }) => user.role === "ADMIN" || user.role === "MANAGER";
const STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "AWAITING_PARTS", "COMPLETED", "CANCELLED"].map((value) => ({ value, label: value.toLowerCase().replaceAll("_", " ") }));
const DAY_MS = 86_400_000;
const CAP = 20_000;

function recordWhere(ctx: ReportContext, extra: Prisma.MaintenanceRecordWhereInput = {}): Prisma.MaintenanceRecordWhereInput {
  const f = ctx.filters;
  return {
    organizationId: ctx.user.organizationId, ...extra,
    ...(f.maintenanceType ? { type: f.maintenanceType as never } : {}),
    equipment: { ...(f.equipment ? { id: f.equipment } : {}), ...(f.equipmentCategory ? { categoryId: f.equipmentCategory } : {}) },
  };
}
const recordInclude = { equipment: { select: { assetNumber: true, name: true, status: true, category: { select: { name: true } } } }, performedBy: true } satisfies Prisma.MaintenanceRecordInclude;

const history: ReportDefinition = {
  id: "maintenance-history", category: "maintenance", title: "Maintenance history",
  description: "Maintenance records opened in a date range (default: last 12 months), with work, cost and who did it.",
  filters: ["dateRange", "equipment", "equipmentCategory", "maintenanceType", "status"], statusOptions: STATUS_OPTIONS, access: staffOnly,
  async run(ctx) {
    const range = rangeOrDefault(ctx, 365);
    const where = recordWhere(ctx, { openedAt: { gte: range.fromDate, lt: range.toExclusive }, ...(ctx.filters.status ? { status: ctx.filters.status as never } : {}) });
    const [rows, total] = await prisma.$transaction([
      prisma.maintenanceRecord.findMany({ where, include: recordInclude, orderBy: [{ openedAt: "desc" }, { id: "asc" }], ...window(ctx) }),
      prisma.maintenanceRecord.count({ where }),
    ]);
    return {
      total, notes: [`Opened ${range.from} to ${range.to}.`],
      columns: [{ label: "Opened" }, { label: "Asset #" }, { label: "Equipment" }, { label: "Type" }, { label: "Status", type: "status" }, { label: "Description" }, { label: "Work performed" }, { label: "By" }, { label: "Cost", type: "money" }, { label: "Completed" }],
      rows: rows.map((r): Cell[] => [instantCell(r.openedAt, ctx.zone), r.equipment.assetNumber, r.equipment.name, TYPE_LABELS[r.type], label(r.status), r.description, r.workPerformed, r.performedBy ? formatName(r.performedBy) : r.vendorName, r.cost ? r.cost.toFixed(2) : null, instantCell(r.completedAt, ctx.zone)]),
    };
  },
};

const open: ReportDefinition = {
  id: "open-maintenance", category: "maintenance", title: "Open maintenance",
  description: "Work that is open, in progress or waiting for parts, with the equipment's current status and any rentals it affects.",
  filters: ["equipment", "equipmentCategory", "maintenanceType"], access: everyone,
  definition: "“Rentals affected” counts reservations that still need the asset (reserved through checked out, not yet returned) while it is in maintenance or out of service.",
  async run(ctx) {
    const where = recordWhere(ctx, { status: { in: ["OPEN", "IN_PROGRESS", "AWAITING_PARTS"] } });
    const [rows, total] = await prisma.$transaction([
      prisma.maintenanceRecord.findMany({ where, include: recordInclude, orderBy: [{ openedAt: "asc" }, { id: "asc" }], ...window(ctx) }),
      prisma.maintenanceRecord.count({ where }),
    ]);
    const affected = new Map<string, number>();
    for (const r of rows) {
      if (r.equipment.status === "MAINTENANCE" || r.equipment.status === "OUT_OF_SERVICE") affected.set(r.equipmentId, (await findRentalConflicts(prisma, ctx.user.organizationId, r.equipmentId, ctx.now)).length);
    }
    return {
      total,
      columns: [{ label: "Asset #" }, { label: "Equipment" }, { label: "Type" }, { label: "Description" }, { label: "Status", type: "status" }, { label: "Equipment status", type: "status" }, { label: "Opened" }, { label: "Days open", type: "number" }, { label: "Assigned" }, { label: "Rentals affected", type: "number" }],
      rows: rows.map((r): Cell[] => [r.equipment.assetNumber, r.equipment.name, TYPE_LABELS[r.type], r.description, label(r.status), label(r.equipment.status), instantCell(r.openedAt, ctx.zone), Math.max(0, Math.floor((ctx.now.getTime() - r.openedAt.getTime()) / DAY_MS)), r.performedBy ? formatName(r.performedBy) : r.vendorName, affected.get(r.equipmentId) ?? 0]),
    };
  },
};

const overdue: ReportDefinition = {
  id: "overdue-maintenance", category: "maintenance", title: "Overdue and due maintenance",
  description: "Service schedules that are due or past due, by date or meter.",
  filters: ["equipment", "equipmentCategory", "maintenanceType"], access: everyone,
  definition: "Derived from each active schedule's next service date/meter and the latest meter reading: overdue = date passed or meter beyond the service point; due = today or exactly at the meter. The due-soon window comes from organization settings.",
  async run(ctx) {
    const policy = await getMaintenancePolicy(ctx.user.organizationId);
    const items = (await loadDueItems(ctx.user, policy, { equipment: ctx.filters.equipment, category: ctx.filters.equipmentCategory, type: ctx.filters.maintenanceType as never }, ctx.zone, ctx.now)).filter((i) => i.due.state === "OVERDUE" || i.due.state === "DUE");
    const rows = items.map((i): Cell[] => [i.assetNumber, i.equipmentName, i.title ?? TYPE_LABELS[i.type as keyof typeof TYPE_LABELS], dateCell(i.nextServiceDate), i.nextServiceDate ? Math.max(0, diffDays(dateKeyUtc(i.nextServiceDate), ctx.today)) : null, i.nextServiceMeter ? `${i.currentMeter ?? "?"} of ${i.nextServiceMeter} ${i.meterUnit?.toLowerCase() ?? ""}` : null, i.due.state === "OVERDUE" ? "overdue" : "due", i.responsible]);
    return { total: rows.length, columns: [{ label: "Asset #" }, { label: "Equipment" }, { label: "Service" }, { label: "Next due" }, { label: "Days overdue", type: "number" }, { label: "Meter" }, { label: "State", type: "status" }, { label: "Responsible" }], rows: pageRows(ctx, rows) };
  },
};

async function completedCosts(ctx: ReportContext) {
  const range = rangeOrDefault(ctx, 365);
  const records = await prisma.maintenanceRecord.findMany({
    where: recordWhere(ctx, { status: "COMPLETED", completedAt: { gte: range.fromDate, lt: range.toExclusive }, cost: { not: null } }),
    select: { cost: true, equipmentId: true, equipment: { select: { assetNumber: true, name: true, category: { select: { name: true } } } } }, take: CAP,
  });
  return { range, records };
}
const org = async (ctx: ReportContext) => (await prisma.organization.findUniqueOrThrow({ where: { id: ctx.user.organizationId }, select: { defaultCurrency: true } })).defaultCurrency;
const COST_DEF = "Sums the recorded cost of maintenance completed in the range (cancelled work excluded), exactly. Only costs someone entered are included; internal labor is not estimated, and amounts are in the organization's default currency. Operational reporting, not an accounting statement.";

const costByEquipment: ReportDefinition = {
  id: "maintenance-cost-by-equipment", category: "maintenance", title: "Maintenance cost by equipment",
  description: "Recorded maintenance cost per asset for work completed in a date range (default: last 12 months).",
  filters: ["dateRange", "equipmentCategory", "maintenanceType", "equipment"], access: staffOnly, definition: COST_DEF,
  async run(ctx) {
    const { range, records } = await completedCosts(ctx);
    const groups = new Map<string, { label: string; count: number; total: P.Decimal }>();
    for (const r of records) { const g = groups.get(r.equipmentId) ?? { label: `${r.equipment.assetNumber}|${r.equipment.name}`, count: 0, total: new P.Decimal(0) }; g.count += 1; g.total = g.total.plus(r.cost ?? 0); groups.set(r.equipmentId, g); }
    const currency = await org(ctx);
    const rows = [...groups.values()].sort((a, b) => b.total.comparedTo(a.total)).map((g): Cell[] => [g.label.split("|")[0], g.label.split("|")[1], g.count, g.total.toFixed(2), currency]);
    const total = [...groups.values()].reduce((sum, g) => sum.plus(g.total), new P.Decimal(0));
    return { total: rows.length, notes: [`Completed ${range.from} to ${range.to}.`], summary: [{ label: `Total (${currency})`, value: total.toFixed(2), money: true }], columns: [{ label: "Asset #" }, { label: "Equipment" }, { label: "Records", type: "number" }, { label: "Total cost", type: "money" }, { label: "Currency" }], rows: pageRows(ctx, rows) };
  },
};

const costByCategory: ReportDefinition = {
  id: "maintenance-cost-by-category", category: "maintenance", title: "Maintenance cost by equipment category",
  description: "Recorded maintenance cost per equipment category for work completed in a date range (default: last 12 months).",
  filters: ["dateRange", "equipmentCategory", "maintenanceType"], access: staffOnly, definition: COST_DEF,
  async run(ctx) {
    const { range, records } = await completedCosts(ctx);
    const groups = new Map<string, { count: number; total: P.Decimal }>();
    for (const r of records) { const k = r.equipment.category?.name ?? "Uncategorized"; const g = groups.get(k) ?? { count: 0, total: new P.Decimal(0) }; g.count += 1; g.total = g.total.plus(r.cost ?? 0); groups.set(k, g); }
    const currency = await org(ctx);
    const rows = [...groups.entries()].sort(([, a], [, b]) => b.total.comparedTo(a.total)).map(([name, g]): Cell[] => [name, g.count, g.total.toFixed(2), currency]);
    return { total: rows.length, notes: [`Completed ${range.from} to ${range.to}.`], columns: [{ label: "Category" }, { label: "Records", type: "number" }, { label: "Total cost", type: "money" }, { label: "Currency" }], rows: pageRows(ctx, rows) };
  },
};

const downtime: ReportDefinition = {
  id: "equipment-downtime", category: "maintenance", title: "Equipment downtime",
  description: "Time each asset spent in maintenance or out of service because of a maintenance record, over a period (default: last 90 days).",
  filters: ["dateRange", "equipment", "equipmentCategory"], access: everyone,
  definition: "Downtime starts when a maintenance record places the asset in Maintenance/Out-of-service status and ends when it is explicitly returned to service (or, if the status was changed some other way, when the record was completed; or now if it is still unavailable). Overlapping periods on one asset are merged, periods are clipped to the report range, and the figure is shown in days of 24 hours. Equipment set out of service without a maintenance record, and time before this feature was used, is not captured.",
  async run(ctx) {
    const range = rangeOrDefault(ctx, 90);
    const f = ctx.filters;
    const start = range.fromDate.getTime(), end = Math.min(range.toExclusive.getTime(), ctx.now.getTime());
    const records = await prisma.maintenanceRecord.findMany({
      where: { organizationId: ctx.user.organizationId, unavailableAt: { not: null, lt: new Date(end) }, equipment: { ...(f.equipment ? { id: f.equipment } : {}), ...(f.equipmentCategory ? { categoryId: f.equipmentCategory } : {}) } },
      select: { equipmentId: true, unavailableAt: true, returnedToServiceAt: true, completedAt: true, status: true, equipment: { select: { assetNumber: true, name: true, status: true } } }, take: CAP,
    });
    const byEquipment = new Map<string, { name: string; assetNumber: string; spans: Array<[number, number]> }>();
    for (const r of records) {
      const stillDown = r.equipment.status === "MAINTENANCE" || r.equipment.status === "OUT_OF_SERVICE";
      const spanEnd = r.returnedToServiceAt?.getTime() ?? (stillDown ? ctx.now.getTime() : r.completedAt?.getTime() ?? ctx.now.getTime());
      const from = Math.max(r.unavailableAt!.getTime(), start), to = Math.min(spanEnd, end);
      if (to <= from) continue;
      const entry = byEquipment.get(r.equipmentId) ?? { name: r.equipment.name, assetNumber: r.equipment.assetNumber, spans: [] };
      entry.spans.push([from, to]);
      byEquipment.set(r.equipmentId, entry);
    }
    const periodDays = Math.max(1, (end - start) / DAY_MS);
    const rows = [...byEquipment.values()].map((entry) => {
      const merged: Array<[number, number]> = [];
      for (const span of entry.spans.sort((a, b) => a[0] - b[0])) {
        const last = merged.at(-1);
        if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]); else merged.push([...span]);
      }
      const days = merged.reduce((sum, [a, b]) => sum + (b - a) / DAY_MS, 0);
      return { entry, periods: merged.length, days };
    }).sort((a, b) => b.days - a.days).map((r): Cell[] => [r.entry.assetNumber, r.entry.name, r.periods, r.days.toFixed(1), `${((r.days / periodDays) * 100).toFixed(1)}%`]);
    return {
      total: rows.length, notes: [`Period ${range.from} to ${ctx.filters.to ?? ctx.today} (${periodDays.toFixed(1)} days).`],
      columns: [{ label: "Asset #" }, { label: "Equipment" }, { label: "Downtime periods", type: "number" }, { label: "Days unavailable", type: "number" }, { label: "Share of period", type: "number" }], rows: pageRows(ctx, rows),
    };
  },
};

export const maintenanceReports = [history, open, overdue, costByEquipment, costByCategory, downtime];
