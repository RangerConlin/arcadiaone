import { Prisma } from "@/generated/prisma/client";
import type { EquipmentCondition, EquipmentStatus, InspectionResult, MaintenanceStatus, MaintenanceType } from "@/generated/prisma/enums";
import { dateKeyUtc, keyToDate } from "@/lib/datetime";
import type { AuthenticatedUser } from "@/lib/auth/session";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { audit, userActor } from "@/modules/audit/service";
import { createLedgerTransaction } from "@/modules/ledger/service";
import { plainDecimal } from "@/modules/ledger/money";
import { canManageMaintenance, canReportIssue, canPostCostToLedger, type MaintenancePolicy } from "./authorization";
import { computeNext } from "./due";
import { findRentalConflicts } from "./rental-conflicts";

type Tx = Prisma.TransactionClient;
type Actor = Pick<AuthenticatedUser, "id" | "email" | "organizationId" | "employeeId" | "role">;

export class MaintenanceError extends Error {}

export const UNAVAILABLE_STATUSES = ["MAINTENANCE", "OUT_OF_SERVICE"] as const;
const isUnavailable = (status: string) => (UNAVAILABLE_STATUSES as readonly string[]).includes(status);
/** Equipment states that belong to the rental workflow; maintenance never overrides them silently. */
const RENTAL_OWNED = new Set(["RESERVED", "PREPARING", "CHECKED_OUT", "INSPECTION"]);

export type OpenInput = {
  equipmentId: string; type: MaintenanceType; description: string; scheduleId: string | null;
  place: "NONE" | "MAINTENANCE" | "OUT_OF_SERVICE"; status: "OPEN" | "IN_PROGRESS";
  performedByEmployeeId: string | null; vendorName: string | null; meterReading: Prisma.Decimal | null; notes: string | null;
};

export async function openRecord(tx: Tx, user: Actor, policy: MaintenancePolicy, input: OpenInput) {
  const manager = canManageMaintenance(user, policy);
  if (!manager && !canReportIssue(user, policy)) throw new MaintenanceError("You cannot open maintenance records.");
  const equipment = await tx.equipment.findFirst({ where: { id: input.equipmentId, organizationId: user.organizationId } });
  if (!equipment) throw new MaintenanceError("Equipment not found.");
  // Employees may only report an issue: no status change, assignment or work details.
  if (!manager) {
    if (!["DAMAGE", "REPAIR", "OTHER"].includes(input.type)) throw new MaintenanceError("Choose damage, repair or other when reporting an issue.");
    if (input.place !== "NONE" || input.performedByEmployeeId || input.vendorName || input.meterReading || input.scheduleId) throw new MaintenanceError("Reporting an issue cannot change equipment status or assign work.");
  }
  if (input.meterReading && !equipment.meterUnit) throw new MaintenanceError("This equipment does not track a meter.");
  if (input.performedByEmployeeId && !await tx.employee.findFirst({ where: { id: input.performedByEmployeeId, organizationId: user.organizationId }, select: { id: true } })) throw new MaintenanceError("Employee not found.");
  if (input.scheduleId && !await tx.maintenanceSchedule.findFirst({ where: { id: input.scheduleId, equipmentId: equipment.id, organizationId: user.organizationId }, select: { id: true } })) throw new MaintenanceError("Schedule not found for this equipment.");
  const now = new Date();
  const place = input.place !== "NONE";
  if (place) {
    if (equipment.status === "CHECKED_OUT") throw new MaintenanceError("This equipment is checked out on a rental. Return it first, or open the record without changing its status.");
    if (equipment.status === "LOST") throw new MaintenanceError("Lost equipment cannot be placed in maintenance.");
  }
  const record = await tx.maintenanceRecord.create({
    data: {
      organizationId: user.organizationId, equipmentId: equipment.id, scheduleId: input.scheduleId, type: input.type, status: input.status, openedAt: now,
      performedByEmployeeId: input.performedByEmployeeId, vendorName: input.vendorName, description: input.description, notes: input.notes,
      meterReading: input.meterReading, createdByUserId: user.id,
      ...(place ? { equipmentStatusApplied: input.place as EquipmentStatus, unavailableAt: now } : {}),
    },
  });
  if (place) await tx.equipment.update({ where: { id: equipment.id }, data: { status: input.place as EquipmentStatus } });
  if (input.meterReading) await recordMeter(tx, user, equipment.id, input.meterReading, `Recorded when maintenance opened`, record.id, false);
  await audit.record(tx, {
    organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.maintenanceOpened, entityType: "MaintenanceRecord", entityId: record.id,
    summary: `${input.type.toLowerCase().replace("_", " ")} opened for ${equipment.assetNumber}: ${input.description}`.slice(0, 500), metadata: { equipmentId: equipment.id, type: input.type, placed: input.place },
  });
  if (place) {
    await audit.record(tx, {
      organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.equipmentPlacedOutOfService, entityType: "Equipment", entityId: equipment.id,
      summary: `${equipment.assetNumber} placed in ${input.place === "MAINTENANCE" ? "maintenance" : "out-of-service"} status`, changes: [{ field: "status", from: equipment.status, to: input.place }], metadata: { maintenanceRecordId: record.id },
    });
  }
  const conflicts = place ? await findRentalConflicts(tx, user.organizationId, equipment.id, now) : [];
  return { record, equipment, conflicts };
}

export async function changeStatus(tx: Tx, user: Actor, policy: MaintenancePolicy, recordId: string, status: "OPEN" | "IN_PROGRESS" | "AWAITING_PARTS") {
  if (!canManageMaintenance(user, policy)) throw new MaintenanceError("You cannot change maintenance status.");
  const record = await tx.maintenanceRecord.findFirst({ where: { id: recordId, organizationId: user.organizationId }, include: { equipment: { select: { assetNumber: true } } } });
  if (!record) throw new MaintenanceError("Record not found.");
  if (record.status === "COMPLETED" || record.status === "CANCELLED") throw new MaintenanceError("Closed records cannot change status.");
  if (record.status === status) return record;
  const updated = await tx.maintenanceRecord.update({ where: { id: recordId }, data: { status } });
  await audit.record(tx, {
    organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.maintenanceStatusChanged, entityType: "MaintenanceRecord", entityId: recordId,
    summary: `${record.equipment.assetNumber} maintenance: ${record.status} → ${status}`, changes: [{ field: "status", from: record.status, to: status }],
  });
  return updated;
}

/** Puts equipment out of service because of an existing open record (e.g. an inspection found a fault). */
export async function placeEquipment(tx: Tx, user: Actor, policy: MaintenancePolicy, recordId: string, place: "MAINTENANCE" | "OUT_OF_SERVICE") {
  if (!canManageMaintenance(user, policy)) throw new MaintenanceError("You cannot change equipment status.");
  const record = await tx.maintenanceRecord.findFirst({ where: { id: recordId, organizationId: user.organizationId }, include: { equipment: true } });
  if (!record) throw new MaintenanceError("Record not found.");
  if (record.status === "COMPLETED" || record.status === "CANCELLED") throw new MaintenanceError("Closed records cannot change equipment status.");
  const eq = record.equipment;
  if (eq.status === "CHECKED_OUT") throw new MaintenanceError("This equipment is checked out on a rental. Return it first.");
  if (eq.status === "LOST") throw new MaintenanceError("Lost equipment cannot be placed in maintenance.");
  const now = new Date();
  await tx.equipment.update({ where: { id: eq.id }, data: { status: place } });
  await tx.maintenanceRecord.update({ where: { id: recordId }, data: { equipmentStatusApplied: place, unavailableAt: record.unavailableAt ?? now, returnedToServiceAt: null } });
  await audit.record(tx, {
    organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.equipmentPlacedOutOfService, entityType: "Equipment", entityId: eq.id,
    summary: `${eq.assetNumber} placed in ${place === "MAINTENANCE" ? "maintenance" : "out-of-service"} status`, changes: [{ field: "status", from: eq.status, to: place }], metadata: { maintenanceRecordId: recordId },
  });
  return { equipment: eq, conflicts: await findRentalConflicts(tx, user.organizationId, eq.id, now) };
}

export type CompleteInput = {
  workPerformed: string; cost: Prisma.Decimal | null; meterReading: Prisma.Decimal | null; vendorName: string | null; performedByEmployeeId: string | null;
  inspectionResult: InspectionResult | null; conditionFound: EquipmentCondition | null; finalCondition: EquipmentCondition | null;
  /** Mandatory and explicit: nothing returns to service by default. */
  postStatus: "AVAILABLE" | "MAINTENANCE" | "OUT_OF_SERVICE" | "KEEP";
  nextServiceDate: string; nextServiceMeter: Prisma.Decimal | null; postCostToLedger: boolean; notes: string | null;
};

export async function completeRecord(tx: Tx, user: Actor, policy: MaintenancePolicy, recordId: string, input: CompleteInput) {
  if (!canManageMaintenance(user, policy)) throw new MaintenanceError("You cannot complete maintenance records.");
  const record = await tx.maintenanceRecord.findFirst({ where: { id: recordId, organizationId: user.organizationId }, include: { equipment: true, schedule: true } });
  if (!record) throw new MaintenanceError("Record not found.");
  if (record.status === "COMPLETED" || record.status === "CANCELLED") throw new MaintenanceError("This record is already closed.");
  const eq = record.equipment;
  if (record.type === "INSPECTION" && !input.inspectionResult) throw new MaintenanceError("Record the inspection result (pass or fail).");
  if (input.meterReading && !eq.meterUnit) throw new MaintenanceError("This equipment does not track a meter.");
  if (input.nextServiceMeter && !eq.meterUnit) throw new MaintenanceError("This equipment does not track a meter.");
  if (input.performedByEmployeeId && !await tx.employee.findFirst({ where: { id: input.performedByEmployeeId, organizationId: user.organizationId }, select: { id: true } })) throw new MaintenanceError("Employee not found.");
  const now = new Date();
  const completionKey = dateKeyUtc(now);

  let returned = false;
  let statusNote: string | null = null;
  if (input.postStatus === "AVAILABLE") {
    if (input.inspectionResult === "FAIL") throw new MaintenanceError("A failed inspection cannot return equipment to service. Choose maintenance or out of service, or keep the status.");
    const holders = await tx.maintenanceRecord.count({ where: { organizationId: user.organizationId, equipmentId: eq.id, id: { not: recordId }, status: { in: ["OPEN", "IN_PROGRESS", "AWAITING_PARTS"] }, equipmentStatusApplied: { not: null }, returnedToServiceAt: null } });
    if (holders) throw new MaintenanceError("Another open maintenance record still holds this equipment out of service. Close it first.");
  }
  if (input.postStatus !== "KEEP") {
    if (isUnavailable(eq.status) || eq.status === "AVAILABLE") {
      if (eq.status !== input.postStatus) {
        await tx.equipment.update({ where: { id: eq.id }, data: { status: input.postStatus as EquipmentStatus } });
        returned = input.postStatus === "AVAILABLE" && isUnavailable(eq.status);
        if (isUnavailable(input.postStatus)) await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.equipmentPlacedOutOfService, entityType: "Equipment", entityId: eq.id, summary: `${eq.assetNumber} kept ${input.postStatus === "MAINTENANCE" ? "in maintenance" : "out of service"} after work`, changes: [{ field: "status", from: eq.status, to: input.postStatus }], metadata: { maintenanceRecordId: recordId } });
      }
    } else if (RENTAL_OWNED.has(eq.status) || eq.status === "LOST") {
      statusNote = `Equipment status was left as ${eq.status.toLowerCase().replace("_", " ")} because it belongs to the rental workflow.`;
    }
  }
  const finalCondition = input.finalCondition ?? input.conditionFound;
  if (finalCondition && finalCondition !== eq.condition) await tx.equipment.update({ where: { id: eq.id }, data: { condition: finalCondition } });

  if (input.meterReading) await recordMeter(tx, user, eq.id, input.meterReading, "Recorded at maintenance completion", recordId, false);
  const meterAtService = input.meterReading ? Number(input.meterReading.toString()) : null;

  // Next-service data writes through to the schedule so due logic has a single source of truth.
  const hasNext = Boolean(input.nextServiceDate) || input.nextServiceMeter !== null;
  let schedule = record.schedule;
  const computed = schedule ? computeNext(schedule, now, meterAtService) : { nextDate: null, nextMeter: null };
  const nextDate = input.nextServiceDate ? keyToDate(input.nextServiceDate) : computed.nextDate;
  const nextMeter = input.nextServiceMeter !== null ? input.nextServiceMeter : computed.nextMeter !== null ? new Prisma.Decimal(computed.nextMeter) : null;
  if (schedule) {
    schedule = await tx.maintenanceSchedule.update({ where: { id: schedule.id }, data: { lastServiceDate: keyToDate(completionKey), lastServiceMeter: input.meterReading ?? schedule.lastServiceMeter, nextServiceDate: nextDate, nextServiceMeter: nextMeter } });
  } else if (hasNext) {
    const existing = await tx.maintenanceSchedule.findFirst({ where: { organizationId: user.organizationId, equipmentId: eq.id, type: record.type, active: true }, orderBy: { createdAt: "asc" } });
    if (existing) {
      await tx.maintenanceSchedule.update({ where: { id: existing.id }, data: { lastServiceDate: keyToDate(completionKey), lastServiceMeter: input.meterReading ?? existing.lastServiceMeter, nextServiceDate: nextDate, nextServiceMeter: nextMeter } });
      await tx.maintenanceRecord.update({ where: { id: recordId }, data: { scheduleId: existing.id } });
    } else {
      const created = await tx.maintenanceSchedule.create({ data: { organizationId: user.organizationId, equipmentId: eq.id, type: record.type, title: "Next service", lastServiceDate: keyToDate(completionKey), lastServiceMeter: input.meterReading, nextServiceDate: nextDate, nextServiceMeter: nextMeter } });
      await tx.maintenanceRecord.update({ where: { id: recordId }, data: { scheduleId: created.id } });
    }
  }

  const updated = await tx.maintenanceRecord.update({
    where: { id: recordId },
    data: {
      status: "COMPLETED", completedAt: now, workPerformed: input.workPerformed, cost: input.cost, meterReading: input.meterReading ?? record.meterReading,
      vendorName: input.vendorName ?? record.vendorName, performedByEmployeeId: input.performedByEmployeeId ?? record.performedByEmployeeId,
      inspectionResult: input.inspectionResult, conditionFound: input.conditionFound, nextServiceDate: nextDate, nextServiceMeter: nextMeter,
      notes: input.notes ?? record.notes, ...(returned || (input.postStatus === "AVAILABLE" && record.equipmentStatusApplied) ? { returnedToServiceAt: now } : {}),
    },
  });
  await audit.record(tx, {
    organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.maintenanceCompleted, entityType: "MaintenanceRecord", entityId: recordId,
    summary: `${eq.assetNumber} ${record.type.toLowerCase().replace("_", " ")} completed`, metadata: { equipmentId: eq.id, cost: input.cost ? plainDecimal(input.cost) : null, inspectionResult: input.inspectionResult, postStatus: input.postStatus, nextServiceDate: nextDate },
  });
  if (returned || (input.postStatus === "AVAILABLE" && record.equipmentStatusApplied)) {
    await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.equipmentReturnedToService, entityType: "Equipment", entityId: eq.id, summary: `${eq.assetNumber} returned to service (available)`, changes: [{ field: "status", from: eq.status, to: "AVAILABLE" }], metadata: { maintenanceRecordId: recordId } });
  }

  let ledgerId: string | null = null;
  const wantsLedger = input.cost && input.cost.gt(0) && (policy.autoPostCost || (input.postCostToLedger && canPostCostToLedger(user)));
  if (wantsLedger) ledgerId = (await postCostToLedger(tx, user, recordId))?.id ?? null;
  return { record: updated, equipment: eq, returned, statusNote, ledgerId };
}

/** Records the maintenance cost as an EXPENSE exactly once (unique maintenanceRecordId), linked back to the record and asset. */
export async function postCostToLedger(tx: Tx, user: Actor, recordId: string) {
  const record = await tx.maintenanceRecord.findFirst({ where: { id: recordId, organizationId: user.organizationId }, include: { equipment: { select: { id: true, assetNumber: true } }, ledgerTransaction: true } });
  if (!record) throw new MaintenanceError("Record not found.");
  if (record.ledgerTransaction) return record.ledgerTransaction;
  if (!record.cost || record.cost.lte(0)) throw new MaintenanceError("There is no cost to post.");
  if (record.status !== "COMPLETED") throw new MaintenanceError("Complete the work before posting its cost.");
  return createLedgerTransaction(tx, user.organizationId, user, user.id, {
    type: "EXPENSE", transactionDate: keyToDate(dateKeyUtc(record.completedAt ?? new Date())), description: `Maintenance — ${record.equipment.assetNumber}: ${record.description}`.slice(0, 300),
    amount: record.cost, equipmentId: record.equipment.id, maintenanceRecordId: record.id, reference: `MR-${record.id.slice(0, 8)}`,
  });
}

export async function cancelRecord(tx: Tx, user: Actor, policy: MaintenancePolicy, recordId: string, postStatus: "AVAILABLE" | "MAINTENANCE" | "OUT_OF_SERVICE" | "KEEP", reason: string | null) {
  if (!canManageMaintenance(user, policy)) throw new MaintenanceError("You cannot cancel maintenance records.");
  const record = await tx.maintenanceRecord.findFirst({ where: { id: recordId, organizationId: user.organizationId }, include: { equipment: true } });
  if (!record) throw new MaintenanceError("Record not found.");
  if (record.status === "COMPLETED" || record.status === "CANCELLED") throw new MaintenanceError("This record is already closed.");
  const holds = Boolean(record.equipmentStatusApplied) && isUnavailable(record.equipment.status);
  let returned = false;
  if (holds && postStatus !== "KEEP" && postStatus !== record.equipment.status) {
    if (postStatus === "AVAILABLE") {
      const others = await tx.maintenanceRecord.count({ where: { organizationId: user.organizationId, equipmentId: record.equipmentId, id: { not: recordId }, status: { in: ["OPEN", "IN_PROGRESS", "AWAITING_PARTS"] }, equipmentStatusApplied: { not: null }, returnedToServiceAt: null } });
      if (others) throw new MaintenanceError("Another open maintenance record still holds this equipment out of service.");
      returned = true;
    }
    await tx.equipment.update({ where: { id: record.equipmentId }, data: { status: postStatus as EquipmentStatus } });
  }
  await tx.maintenanceRecord.update({ where: { id: recordId }, data: { status: "CANCELLED", completedAt: new Date(), ...(returned ? { returnedToServiceAt: new Date() } : {}) } });
  await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.maintenanceCancelled, entityType: "MaintenanceRecord", entityId: recordId, summary: `${record.equipment.assetNumber} maintenance cancelled`, metadata: { reason, postStatus: holds ? postStatus : "n/a" } });
  if (returned) await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.equipmentReturnedToService, entityType: "Equipment", entityId: record.equipmentId, summary: `${record.equipment.assetNumber} returned to service (available)`, metadata: { maintenanceRecordId: recordId } });
  return record;
}

export async function recordMeter(tx: Tx, user: Actor, equipmentId: string, reading: Prisma.Decimal, notes: string | null, maintenanceRecordId: string | null = null, requireManager = true, policy?: MaintenancePolicy) {
  if (requireManager && policy && !canManageMaintenance(user, policy)) throw new MaintenanceError("You cannot record meter readings.");
  const equipment = await tx.equipment.findFirst({ where: { id: equipmentId, organizationId: user.organizationId }, select: { meterUnit: true } });
  if (!equipment) throw new MaintenanceError("Equipment not found.");
  if (!equipment.meterUnit) throw new MaintenanceError("This equipment does not track a meter.");
  const latest = await tx.meterReading.findFirst({ where: { equipmentId, organizationId: user.organizationId }, orderBy: [{ recordedAt: "desc" }, { reading: "desc" }] });
  if (latest && reading.lt(latest.reading)) throw new MaintenanceError(`The reading cannot be lower than the last one (${latest.reading.toFixed(1)}).`);
  return tx.meterReading.create({ data: { organizationId: user.organizationId, equipmentId, reading, recordedByUserId: user.id, notes, maintenanceRecordId } });
}

export type ScheduleInput = {
  id: string | null; equipmentId: string; type: MaintenanceType; title: string | null; intervalDays: number | null; intervalMonths: number | null;
  intervalMeter: Prisma.Decimal | null; lastServiceDate: string; nextServiceDate: string; nextServiceMeter: Prisma.Decimal | null; lastServiceMeter: Prisma.Decimal | null;
  responsibleEmployeeId: string | null; active: boolean;
};

export async function saveSchedule(tx: Tx, user: Actor, policy: MaintenancePolicy, input: ScheduleInput) {
  if (!canManageMaintenance(user, policy)) throw new MaintenanceError("You cannot manage service schedules.");
  const equipment = await tx.equipment.findFirst({ where: { id: input.equipmentId, organizationId: user.organizationId } });
  if (!equipment) throw new MaintenanceError("Equipment not found.");
  if ((input.intervalMeter || input.nextServiceMeter) && !equipment.meterUnit) throw new MaintenanceError("Set the equipment's meter unit before scheduling by meter.");
  if (!input.intervalDays && !input.intervalMonths && !input.intervalMeter && !input.nextServiceDate && !input.nextServiceMeter) throw new MaintenanceError("Give the schedule an interval or a next service date or meter.");
  if (input.responsibleEmployeeId && !await tx.employee.findFirst({ where: { id: input.responsibleEmployeeId, organizationId: user.organizationId }, select: { id: true } })) throw new MaintenanceError("Employee not found.");
  const last = input.lastServiceDate ? keyToDate(input.lastServiceDate) : null;
  const computed = last ? computeNext({ intervalDays: input.intervalDays, intervalMonths: input.intervalMonths, intervalMeter: input.intervalMeter }, last, input.lastServiceMeter ? Number(input.lastServiceMeter.toString()) : null) : { nextDate: null, nextMeter: null };
  const data = {
    equipmentId: input.equipmentId, type: input.type, title: input.title, intervalDays: input.intervalMonths ? null : input.intervalDays, intervalMonths: input.intervalMonths, intervalMeter: input.intervalMeter,
    lastServiceDate: last, lastServiceMeter: input.lastServiceMeter,
    nextServiceDate: input.nextServiceDate ? keyToDate(input.nextServiceDate) : computed.nextDate,
    nextServiceMeter: input.nextServiceMeter ?? (computed.nextMeter !== null ? new Prisma.Decimal(computed.nextMeter) : null),
    responsibleEmployeeId: input.responsibleEmployeeId, active: input.active,
  };
  if (input.id) {
    const owned = await tx.maintenanceSchedule.findFirst({ where: { id: input.id, organizationId: user.organizationId, equipmentId: input.equipmentId } });
    if (!owned) throw new MaintenanceError("Schedule not found.");
  }
  const schedule = input.id ? await tx.maintenanceSchedule.update({ where: { id: input.id }, data }) : await tx.maintenanceSchedule.create({ data: { ...data, organizationId: user.organizationId } });
  await audit.record(tx, {
    organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.maintenanceScheduleSaved, entityType: "MaintenanceSchedule", entityId: schedule.id,
    summary: `${equipment.assetNumber} ${input.type.toLowerCase().replace("_", " ")} schedule ${input.id ? "updated" : "created"}`, metadata: { equipmentId: equipment.id, nextServiceDate: schedule.nextServiceDate, active: schedule.active },
  });
  return schedule;
}

export type { MaintenanceStatus };
