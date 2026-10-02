import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedUser } from "@/lib/auth/session";
import { todayKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { DUE_STATES, evaluateDue, type DueResult, type DueState } from "./due";
import type { MaintenancePolicy } from "./authorization";
import { TYPES, STATUSES } from "./validation";

export type MaintenanceFilters = { equipment?: string; category?: string; type?: (typeof TYPES)[number]; status?: (typeof STATUSES)[number]; due?: Exclude<DueState, "OK"> };
type Params = Record<string, string | string[] | undefined>;
const one = (params: Params, key: string) => { const v = params[key]; return (Array.isArray(v) ? v[0] : v)?.trim() || undefined; };
const id = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

export function parseMaintenanceFilters(params: Params): MaintenanceFilters {
  return {
    equipment: id(one(params, "equipment")), category: id(one(params, "category")),
    type: TYPES.find((t) => t === one(params, "type")), status: STATUSES.find((s) => s === one(params, "status")),
    due: (DUE_STATES.filter((s) => s !== "OK") as Array<Exclude<DueState, "OK">>).find((s) => s === one(params, "due")),
  };
}

const equipmentFilter = (f: MaintenanceFilters): Prisma.EquipmentWhereInput => ({ ...(f.equipment ? { id: f.equipment } : {}), ...(f.category ? { categoryId: f.category } : {}) });

export type DueItem = {
  id: string; equipmentId: string; assetNumber: string; equipmentName: string; categoryName: string | null; equipmentStatus: string; type: string; title: string | null;
  nextServiceDate: Date | null; nextServiceMeter: string | null; meterUnit: string | null; currentMeter: string | null; due: DueResult; responsible: string | null;
};

/** Latest meter reading per asset, newest first. */
export async function latestMeters(organizationId: string, equipmentIds: string[]) {
  if (!equipmentIds.length) return new Map<string, Prisma.Decimal>();
  const rows = await prisma.meterReading.findMany({ where: { organizationId, equipmentId: { in: equipmentIds } }, orderBy: [{ recordedAt: "desc" }, { reading: "desc" }], distinct: ["equipmentId"], select: { equipmentId: true, reading: true } });
  return new Map(rows.map((r) => [r.equipmentId, r.reading]));
}

/** Every active schedule with its derived due state, most urgent first. States are computed, never stored. */
export async function loadDueItems(user: AuthenticatedUser, policy: MaintenancePolicy, filters: MaintenanceFilters, zone: string, now = new Date()): Promise<DueItem[]> {
  const today = todayKey(zone, now);
  const schedules = await prisma.maintenanceSchedule.findMany({
    where: { organizationId: user.organizationId, active: true, equipment: { active: true, ...equipmentFilter(filters) }, ...(filters.type ? { type: filters.type } : {}), OR: [{ nextServiceDate: { not: null } }, { nextServiceMeter: { not: null } }] },
    include: { equipment: { select: { id: true, assetNumber: true, name: true, status: true, meterUnit: true, category: { select: { name: true } } } }, responsibleEmployee: { select: { firstName: true, lastName: true } } },
    take: 1000,
  });
  const meters = await latestMeters(user.organizationId, [...new Set(schedules.map((s) => s.equipmentId))]);
  const items = schedules.map((s): DueItem => {
    const current = meters.get(s.equipmentId) ?? null;
    return {
      id: s.id, equipmentId: s.equipmentId, assetNumber: s.equipment.assetNumber, equipmentName: s.equipment.name, categoryName: s.equipment.category?.name ?? null, equipmentStatus: s.equipment.status,
      type: s.type, title: s.title, nextServiceDate: s.nextServiceDate, nextServiceMeter: s.nextServiceMeter?.toString() ?? null, meterUnit: s.equipment.meterUnit, currentMeter: current?.toString() ?? null,
      due: evaluateDue({ nextServiceDate: s.nextServiceDate, nextServiceMeter: s.nextServiceMeter, intervalMeter: s.intervalMeter, currentMeter: current, today, dueSoonDays: policy.dueSoonDays, meterWarningPercent: policy.meterWarningPercent }),
      responsible: s.responsibleEmployee ? `${s.responsibleEmployee.firstName} ${s.responsibleEmployee.lastName}` : null,
    };
  });
  const rank = { OVERDUE: 0, DUE: 1, DUE_SOON: 2, OK: 3 } as const;
  return items.sort((a, b) => rank[a.due.state] - rank[b.due.state] || (a.nextServiceDate?.getTime() ?? Infinity) - (b.nextServiceDate?.getTime() ?? Infinity));
}

export const recordInclude = { equipment: { select: { id: true, assetNumber: true, name: true, status: true, category: { select: { name: true } } } }, performedBy: { select: { firstName: true, lastName: true } } } satisfies Prisma.MaintenanceRecordInclude;

export async function listOpenRecords(user: AuthenticatedUser, f: MaintenanceFilters) {
  return prisma.maintenanceRecord.findMany({
    where: { organizationId: user.organizationId, status: f.status ? f.status : { in: ["OPEN", "IN_PROGRESS", "AWAITING_PARTS"] }, ...(f.type ? { type: f.type } : {}), equipment: equipmentFilter(f) },
    include: recordInclude, orderBy: [{ openedAt: "desc" }], take: 100,
  });
}

export async function listRecentCompleted(user: AuthenticatedUser, f: MaintenanceFilters, now = new Date()) {
  if (f.status && f.status !== "COMPLETED" && f.status !== "CANCELLED") return [];
  return prisma.maintenanceRecord.findMany({
    where: { organizationId: user.organizationId, status: f.status ?? "COMPLETED", completedAt: { gte: new Date(now.getTime() - 60 * 86_400_000) }, ...(f.type ? { type: f.type } : {}), equipment: equipmentFilter(f) },
    include: recordInclude, orderBy: [{ completedAt: "desc" }], take: 50,
  });
}
