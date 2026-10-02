"use server";

import { redirect } from "next/navigation";
import { requireAuthenticatedUser, requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { diffChanges } from "@/modules/audit/sanitize";
import { audit, userActor } from "@/modules/audit/service";
import { createDocument } from "@/modules/documents/service";
import { notifyEquipmentUnavailable, notifyMaintenanceCompleted } from "@/modules/notifications/events";
import { canManageMaintenance, canPostCostToLedger, getMaintenancePolicy } from "./authorization";
import * as svc from "./service";
import { completeSchema, openSchema, parseNumber, scheduleSchema } from "./validation";

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const fail = (path: string, message: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
const done = (path: string, message: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}success=${encodeURIComponent(message)}`);

async function run<T>(path: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof svc.MaintenanceError) return fail(path, error.message);
    if ((error as { code?: string })?.code === "P2002") return fail(path, "That already exists.");
    throw error;
  }
}

export async function openMaintenance(form: FormData) {
  const user = await requireAuthenticatedUser();
  const policy = await getMaintenancePolicy(user.organizationId);
  const back = text(form, "returnEquipmentId");
  const path = back ? `/maintenance/new?equipment=${back}` : "/maintenance/new";
  const parsed = openSchema.safeParse({
    equipmentId: text(form, "equipmentId"), type: text(form, "type") || "OTHER", description: text(form, "description"), place: text(form, "place") || "NONE", status: text(form, "status") || "OPEN",
    scheduleId: text(form, "scheduleId"), performedByEmployeeId: text(form, "performedByEmployeeId"), vendorName: text(form, "vendorName"), meterReading: text(form, "meterReading"), notes: text(form, "notes"),
  });
  if (!parsed.success) return fail(path, parsed.error.issues[0]?.message ?? "Invalid record.");
  const result = await run(path, () => prisma.$transaction((tx) => svc.openRecord(tx, user, policy, parsed.data)));
  if (parsed.data.place !== "NONE") {
    await notifyEquipmentUnavailable({ organizationId: user.organizationId, equipmentId: result.equipment.id, status: parsed.data.place, actorUserId: user.id, maintenanceRecordId: result.record.id });
  }
  const warning = result.conflicts.length ? ` Warning: ${result.conflicts.length} rental${result.conflicts.length === 1 ? "" : "s"} still need this equipment — review them below.` : "";
  return done(`/maintenance/${result.record.id}`, `Maintenance record opened.${warning}`);
}

export async function changeMaintenanceStatus(form: FormData) {
  const user = await requireAuthenticatedUser();
  const id = text(form, "id"), path = `/maintenance/${id}`;
  const status = text(form, "status");
  if (!["OPEN", "IN_PROGRESS", "AWAITING_PARTS"].includes(status)) return fail(path, "Choose a valid status.");
  const policy = await getMaintenancePolicy(user.organizationId);
  await run(path, () => prisma.$transaction((tx) => svc.changeStatus(tx, user, policy, id, status as "OPEN")));
  return done(path, "Status updated.");
}

export async function placeEquipmentAction(form: FormData) {
  const user = await requireAuthenticatedUser();
  const id = text(form, "id"), path = `/maintenance/${id}`;
  const place = text(form, "place");
  if (place !== "MAINTENANCE" && place !== "OUT_OF_SERVICE") return fail(path, "Choose maintenance or out of service.");
  const policy = await getMaintenancePolicy(user.organizationId);
  const result = await run(path, () => prisma.$transaction((tx) => svc.placeEquipment(tx, user, policy, id, place)));
  await notifyEquipmentUnavailable({ organizationId: user.organizationId, equipmentId: result.equipment.id, status: place, actorUserId: user.id, maintenanceRecordId: id });
  return done(path, `Equipment placed in ${place === "MAINTENANCE" ? "maintenance" : "out-of-service"} status.${result.conflicts.length ? ` ${result.conflicts.length} rental(s) are affected.` : ""}`);
}

export async function completeMaintenance(form: FormData) {
  const user = await requireAuthenticatedUser();
  const id = text(form, "id"), path = `/maintenance/${id}`;
  const parsed = completeSchema.safeParse({
    workPerformed: text(form, "workPerformed"), cost: text(form, "cost"), meterReading: text(form, "meterReading"), vendorName: text(form, "vendorName"),
    performedByEmployeeId: text(form, "performedByEmployeeId"), inspectionResult: text(form, "inspectionResult"), conditionFound: text(form, "conditionFound"), finalCondition: text(form, "finalCondition"),
    postStatus: text(form, "postStatus"), nextServiceDate: text(form, "nextServiceDate"), nextServiceMeter: text(form, "nextServiceMeter"),
    postCostToLedger: form.get("postCostToLedger") === "on" && canPostCostToLedger(user), notes: text(form, "notes"),
  });
  if (!parsed.success) return fail(path, parsed.error.issues[0]?.message ?? "Invalid completion.");
  const policy = await getMaintenancePolicy(user.organizationId);
  const result = await run(path, () => prisma.$transaction((tx) => svc.completeRecord(tx, user, policy, id, parsed.data)));
  await notifyMaintenanceCompleted({ organizationId: user.organizationId, recordId: id, actorUserId: user.id });
  if (parsed.data.postStatus === "MAINTENANCE" || parsed.data.postStatus === "OUT_OF_SERVICE") {
    if (result.equipment.status !== parsed.data.postStatus) await notifyEquipmentUnavailable({ organizationId: user.organizationId, equipmentId: result.equipment.id, status: parsed.data.postStatus, actorUserId: user.id, maintenanceRecordId: id });
  }
  const notes = [result.returned ? "Equipment returned to service." : "", result.statusNote ?? "", result.ledgerId ? "Cost recorded in the ledger." : ""].filter(Boolean).join(" ");
  return done(path, `Maintenance completed. ${notes}`.trim());
}

export async function cancelMaintenance(form: FormData) {
  const user = await requireAuthenticatedUser();
  const id = text(form, "id"), path = `/maintenance/${id}`;
  const policy = await getMaintenancePolicy(user.organizationId);
  const post = text(form, "postStatus") || "KEEP";
  if (!["AVAILABLE", "MAINTENANCE", "OUT_OF_SERVICE", "KEEP"].includes(post)) return fail(path, "Choose the equipment's status.");
  await run(path, () => prisma.$transaction((tx) => svc.cancelRecord(tx, user, policy, id, post as "KEEP", text(form, "reason").slice(0, 300) || null)));
  return done(path, "Maintenance record cancelled.");
}

export async function postMaintenanceCost(form: FormData) {
  const user = await requireAuthenticatedUser();
  const id = text(form, "id"), path = `/maintenance/${id}`;
  if (!canPostCostToLedger(user)) redirect("/forbidden");
  await run(path, () => prisma.$transaction((tx) => svc.postCostToLedger(tx, user, id)));
  return done(path, "Cost recorded as a ledger expense.");
}

export async function saveScheduleAction(form: FormData) {
  const user = await requireAuthenticatedUser();
  const equipmentId = text(form, "equipmentId"), path = `/rentals/equipment/${equipmentId}`;
  const policy = await getMaintenancePolicy(user.organizationId);
  if (!canManageMaintenance(user, policy)) redirect("/forbidden");
  const parsed = scheduleSchema.safeParse({
    id: text(form, "id"), equipmentId, type: text(form, "type") || "PREVENTIVE", title: text(form, "title"), intervalDays: text(form, "intervalDays"), intervalMonths: text(form, "intervalMonths"),
    intervalMeter: text(form, "intervalMeter"), lastServiceDate: text(form, "lastServiceDate"), lastServiceMeter: text(form, "lastServiceMeter"), nextServiceDate: text(form, "nextServiceDate"),
    nextServiceMeter: text(form, "nextServiceMeter"), responsibleEmployeeId: text(form, "responsibleEmployeeId"), active: form.get("active") !== "false",
  });
  if (!parsed.success) return fail(path, parsed.error.issues[0]?.message ?? "Invalid schedule.");
  await run(path, () => prisma.$transaction((tx) => svc.saveSchedule(tx, user, policy, parsed.data)));
  return done(path, "Service schedule saved.");
}

export async function recordMeterAction(form: FormData) {
  const user = await requireAuthenticatedUser();
  const equipmentId = text(form, "equipmentId"), path = `/rentals/equipment/${equipmentId}`;
  const policy = await getMaintenancePolicy(user.organizationId);
  const reading = parseNumber(text(form, "reading"), 1, 11);
  if (!reading) return fail(path, "Enter the reading as a non-negative number with at most one decimal.");
  await run(path, () => prisma.$transaction((tx) => svc.recordMeter(tx, user, equipmentId, reading, text(form, "notes").slice(0, 300) || null, null, true, policy)));
  return done(path, "Meter reading recorded.");
}

export async function setMeterUnit(form: FormData) {
  const user = await requireAuthenticatedUser();
  const equipmentId = text(form, "equipmentId"), path = `/rentals/equipment/${equipmentId}`;
  const policy = await getMaintenancePolicy(user.organizationId);
  if (!canManageMaintenance(user, policy)) redirect("/forbidden");
  const unit = text(form, "meterUnit");
  if (unit && !["HOURS", "MILES", "CYCLES"].includes(unit)) return fail(path, "Choose hours, miles or cycles.");
  const equipment = await prisma.equipment.findFirst({ where: { id: equipmentId, organizationId: user.organizationId } });
  if (!equipment) return fail("/rentals/equipment", "Equipment not found.");
  if (equipment.meterUnit !== (unit || null) && await prisma.meterReading.count({ where: { equipmentId } })) return fail(path, "This equipment already has readings; its unit cannot be changed.");
  await prisma.$transaction(async (tx) => {
    await tx.equipment.update({ where: { id: equipmentId }, data: { meterUnit: (unit || null) as "HOURS" | null } });
    const changes = diffChanges(equipment, { meterUnit: unit || null }, ["meterUnit"]);
    if (changes.length) await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.maintenanceScheduleSaved, entityType: "Equipment", entityId: equipmentId, summary: `${equipment.assetNumber} meter tracking ${unit ? `set to ${unit.toLowerCase()}` : "turned off"}`, changes });
  });
  return done(path, "Meter setting saved.");
}

export async function attachMaintenanceDocument(form: FormData) {
  const user = await requireAuthenticatedUser();
  const id = text(form, "recordId"), path = `/maintenance/${id}`;
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return fail(path, "Choose a file.");
  const policy = await getMaintenancePolicy(user.organizationId);
  const record = await prisma.maintenanceRecord.findFirst({ where: { id, organizationId: user.organizationId }, select: { createdByUserId: true, description: true } });
  if (!record || !(canManageMaintenance(user, policy) || record.createdByUserId === user.id)) redirect("/forbidden");
  try {
    await createDocument({ title: text(form, "title") || `Maintenance — ${record!.description.slice(0, 80)}`, relationField: "maintenanceRecordId", relationId: id, file }, user);
  } catch (error) {
    return fail(path, error instanceof Error ? error.message : "Upload failed.");
  }
  return done(path, "Document attached.");
}

export async function saveMaintenanceSettings(form: FormData) {
  const user = await requireRole("ADMIN");
  const path = "/administration/lifecycle";
  const soon = Number(text(form, "maintenanceDueSoonDays")), percent = Number(text(form, "maintenanceMeterWarningPercent"));
  if (!Number.isInteger(soon) || soon < 1 || soon > 180) return fail(path, "The due-soon window must be 1–180 days.");
  if (!Number.isInteger(percent) || percent < 1 || percent > 50) return fail(path, "The meter warning must be 1–50 percent.");
  const data = {
    managersCanManageMaintenance: form.get("managersCanManageMaintenance") === "on", employeesCanReportMaintenance: form.get("employeesCanReportMaintenance") === "on",
    autoPostMaintenanceCostToLedger: form.get("autoPostMaintenanceCostToLedger") === "on", maintenanceDueSoonDays: soon, maintenanceMeterWarningPercent: percent,
  };
  await prisma.$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    await tx.organization.update({ where: { id: user.organizationId }, data });
    const changes = diffChanges(before, data, Object.keys(data));
    if (changes.length) await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.maintenanceSettingsChanged, entityType: "Organization", entityId: user.organizationId, summary: "Maintenance policy changed", changes });
  });
  return done(path, "Maintenance settings saved.");
}
