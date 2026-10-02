import type { Prisma } from "@/generated/prisma/client";
import { diffDays } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { dateKeyInZone } from "@/lib/datetime";
import { formatName } from "@/lib/format";
import { instantCell, label, pageRows, rangeOrDefault, window } from "../helpers";
import type { ReportDefinition } from "../types";

// Rentals and equipment are organization-wide for every signed-in user, matching the Rentals module.
const everyone = () => true;
const EQUIPMENT_STATUSES = ["AVAILABLE", "RESERVED", "PREPARING", "CHECKED_OUT", "INSPECTION", "MAINTENANCE", "OUT_OF_SERVICE", "LOST"].map((value) => ({ value, label: value.toLowerCase().replaceAll("_", " ") }));
const RENTAL_STATUSES = ["RESERVED", "PREPARING", "READY", "CHECKED_OUT", "PARTIALLY_RETURNED", "RETURNED", "CLOSED", "CANCELLED"].map((value) => ({ value, label: value.toLowerCase().replaceAll("_", " ") }));

const inventory: ReportDefinition = {
  id: "equipment-inventory", category: "rentals", title: "Equipment inventory",
  description: "Assets with category, status, condition and location.",
  filters: ["status"], statusOptions: EQUIPMENT_STATUSES, access: everyone,
  async run(ctx) {
    const where: Prisma.EquipmentWhereInput = { organizationId: ctx.user.organizationId, ...(ctx.filters.status ? { status: ctx.filters.status as never } : {}) };
    const [rows, total, groups] = await prisma.$transaction([
      prisma.equipment.findMany({ where, include: { category: true, location: true }, orderBy: [{ assetNumber: "asc" }, { id: "asc" }], ...window(ctx) }),
      prisma.equipment.count({ where }),
      prisma.equipment.groupBy({ by: ["status"], where: { organizationId: ctx.user.organizationId }, _count: { _all: true }, orderBy: { status: "asc" } }),
    ]);
    return {
      total, summary: groups.map((g) => ({ label: g.status.toLowerCase().replaceAll("_", " "), value: String(g._count._all) })),
      columns: [{ label: "Asset #" }, { label: "Equipment" }, { label: "Category" }, { label: "Status", type: "status" }, { label: "Condition", type: "status" }, { label: "Location" }],
      rows: rows.map((e) => [e.assetNumber, e.name, e.category?.name ?? null, label(e.status), label(e.condition), e.location?.name ?? null]),
    };
  },
};

const rentalInclude = { client: { select: { name: true } }, project: { select: { name: true } }, _count: { select: { items: true } } } satisfies Prisma.RentalInclude;

const activity: ReportDefinition = {
  id: "rental-activity", category: "rentals", title: "Rental activity",
  description: "Rentals whose reservation overlaps a date range (default: last 30 days).",
  filters: ["dateRange", "client", "project", "status"], statusOptions: RENTAL_STATUSES, access: everyone,
  async run(ctx) {
    const range = rangeOrDefault(ctx, 30);
    const where: Prisma.RentalWhereInput = {
      organizationId: ctx.user.organizationId, reservationStart: { lt: range.toExclusive }, reservationEnd: { gte: range.fromDate },
      ...(ctx.filters.client ? { clientId: ctx.filters.client } : {}), ...(ctx.filters.project ? { projectId: ctx.filters.project } : {}),
      ...(ctx.filters.status ? { status: ctx.filters.status as never } : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.rental.findMany({ where, include: rentalInclude, orderBy: [{ reservationStart: "desc" }, { id: "asc" }], ...window(ctx) }),
      prisma.rental.count({ where }),
    ]);
    return {
      total, notes: [`Reservations overlapping ${range.from} to ${range.to}.`],
      columns: [{ label: "Rental #" }, { label: "Client" }, { label: "Project" }, { label: "Start" }, { label: "End" }, { label: "Status", type: "status" }, { label: "Items", type: "number" }],
      rows: rows.map((r) => [r.rentalNumber, r.client?.name ?? null, r.project?.name ?? null, instantCell(r.reservationStart, ctx.zone), instantCell(r.reservationEnd, ctx.zone), label(r.status), r._count.items]),
    };
  },
};

const overdue: ReportDefinition = {
  id: "overdue-rentals", category: "rentals", title: "Overdue rentals",
  description: "Checked-out rentals whose reservation end has passed.",
  filters: ["client", "project"], access: everyone,
  definition: "Overdue means the reservation end is before now and the rental is still checked out or only partially returned.",
  async run(ctx) {
    const where: Prisma.RentalWhereInput = {
      organizationId: ctx.user.organizationId, status: { in: ["CHECKED_OUT", "PARTIALLY_RETURNED"] }, reservationEnd: { lt: ctx.now },
      ...(ctx.filters.client ? { clientId: ctx.filters.client } : {}), ...(ctx.filters.project ? { projectId: ctx.filters.project } : {}),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.rental.findMany({ where, include: { ...rentalInclude, checkedOutBy: true }, orderBy: [{ reservationEnd: "asc" }, { id: "asc" }], ...window(ctx) }),
      prisma.rental.count({ where }),
    ]);
    return {
      total,
      columns: [{ label: "Rental #" }, { label: "Client" }, { label: "Project" }, { label: "Was due" }, { label: "Days overdue", type: "number" }, { label: "Status", type: "status" }, { label: "Items", type: "number" }, { label: "Checked out by" }],
      rows: rows.map((r) => [r.rentalNumber, r.client?.name ?? null, r.project?.name ?? null, instantCell(r.reservationEnd, ctx.zone), diffDays(dateKeyInZone(r.reservationEnd, ctx.zone), ctx.today), label(r.status), r._count.items, r.checkedOutBy ? formatName(r.checkedOutBy) : null]),
    };
  },
};

const DAY_MS = 86_400_000;

const utilization: ReportDefinition = {
  id: "equipment-utilization", category: "rentals", title: "Equipment utilization",
  description: "Days each asset was out on rental during a period (default: last 30 days).",
  filters: ["dateRange"], access: everyone,
  definition: "Rented days = days between actual checkout (or reservation start if never checked out) and actual return (or now, if still out), clipped to the period and counted in whole days; cancelled and draft rentals are ignored. Utilization % = rented days ÷ days in the period. Simultaneous rentals of one asset do not occur, so days are not double counted. It measures time out, not revenue.",
  async run(ctx) {
    const range = rangeOrDefault(ctx, 30);
    const periodDays = diffDays(range.from, range.to) + 1;
    const items = await prisma.rentalItem.findMany({
      where: {
        rental: { organizationId: ctx.user.organizationId, status: { in: ["CHECKED_OUT", "PARTIALLY_RETURNED", "RETURNED", "CLOSED"] }, reservationStart: { lt: addDaysDate(range.toExclusive, 400) }, reservationEnd: { gte: addDaysDate(range.fromDate, -400) } },
      },
      select: { equipmentId: true, checkedOutAt: true, returnedAt: true, rental: { select: { reservationStart: true, reservationEnd: true } } },
      take: 20_000,
    });
    const days = new Map<string, number>();
    for (const item of items) {
      const start = item.checkedOutAt ?? item.rental.reservationStart;
      const end = item.returnedAt ?? (item.checkedOutAt ? ctx.now : item.rental.reservationEnd);
      const from = Math.max(start.getTime(), range.fromDate.getTime()), to = Math.min(end.getTime(), range.toExclusive.getTime());
      if (to <= from) continue;
      days.set(item.equipmentId, (days.get(item.equipmentId) ?? 0) + Math.ceil((to - from) / DAY_MS));
    }
    const equipment = await prisma.equipment.findMany({ where: { organizationId: ctx.user.organizationId, active: true, rentable: true }, include: { category: true }, orderBy: [{ assetNumber: "asc" }], take: 5000 });
    const rows = equipment.map((e) => {
      const rented = Math.min(days.get(e.id) ?? 0, periodDays);
      return [e.assetNumber, e.name, e.category?.name ?? null, rented, periodDays, `${((rented / periodDays) * 100).toFixed(1)}%`];
    });
    return {
      total: rows.length, notes: [`Period ${range.from} to ${range.to} (${periodDays} days). Rentable, active assets only.`],
      columns: [{ label: "Asset #" }, { label: "Equipment" }, { label: "Category" }, { label: "Rented days", type: "number" }, { label: "Period days", type: "number" }, { label: "Utilization", type: "number" }],
      rows: pageRows(ctx, rows),
    };
  },
};
const addDaysDate = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
export const rentalReports: ReportDefinition[] = [inventory, activity, overdue, utilization];
