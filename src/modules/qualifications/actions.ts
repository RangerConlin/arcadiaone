"use server";

import { redirect } from "next/navigation";
import { canEditEmployee, requireAuthenticatedUser, requireRole } from "@/lib/auth/session";
import { getCurrentOrganization } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { diffChanges } from "@/modules/audit/sanitize";
import { audit, userActor } from "@/modules/audit/service";
import { calculateExpirationDate } from "./status";
import { employeeQualificationSchema, qualificationTypeSchema, requirementSchema } from "./validation";

const value = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const checked = (data: FormData, key: string) => data.get(key) === "on" || data.get(key) === "true";
const fail = (path: string, message: string): never => redirect(`${path}?error=${encodeURIComponent(message)}`);
const message = (error: { issues: { message: string }[] }) => error.issues[0]?.message ?? "Check the form and try again.";

/** Credential numbers and notes are never audited; only these fields are. */
const QUALIFICATION_AUDIT_FIELDS = ["qualificationTypeId", "issueDate", "expirationDate", "issuingOrganization"] as const;

async function requireEmployeeEditor(employeeId: string) {
  const user = await requireAuthenticatedUser();
  if (!(await canEditEmployee(user, employeeId))) redirect("/forbidden");
  return user;
}

function typeInput(data: FormData) {
  return { name: value(data, "name"), abbreviation: value(data, "abbreviation"), description: value(data, "description"), category: value(data, "category"), issuingOrganization: value(data, "issuingOrganization"), expirationBehavior: value(data, "expirationBehavior"), defaultValidityMonths: value(data, "defaultValidityMonths"), credentialNumberExpected: checked(data, "credentialNumberExpected"), documentExpected: checked(data, "documentExpected"), active: checked(data, "active") };
}

export async function saveQualificationType(data: FormData) {
  await requireRole("ADMIN");
  const id = value(data, "id");
  const path = id ? `/administration/qualifications/${id}/edit` : "/administration/qualifications/new";
  const parsed = qualificationTypeSchema.safeParse(typeInput(data));
  if (!parsed.success) return fail(path, message(parsed.error));
  const parsedData = parsed.data;
  const organization = await getCurrentOrganization();
  try {
    if (id) {
      const result = await prisma.qualificationType.updateMany({ where: { id, organizationId: organization.id }, data: parsedData });
      if (!result.count) fail("/administration/qualifications", "Qualification type was not found.");
    } else await prisma.qualificationType.create({ data: { ...parsedData, organizationId: organization.id } });
  } catch { fail(path, "The qualification type could not be saved. Its name may already be in use."); }
  redirect("/administration/qualifications?success=Qualification type saved.");
}

function credentialInput(data: FormData) {
  return { employeeId: value(data, "employeeId"), qualificationTypeId: value(data, "qualificationTypeId"), credentialNumber: value(data, "credentialNumber"), issuingOrganization: value(data, "issuingOrganization"), issueDate: value(data, "issueDate"), expirationDate: value(data, "expirationDate"), notes: value(data, "notes") };
}

export async function saveEmployeeQualification(data: FormData) {
  const id = value(data, "id");
  const employeeId = value(data, "employeeId");
  const editor = await requireEmployeeEditor(employeeId);
  const path = `/people/${employeeId}/qualifications/${id || "new"}`;
  const parsed = employeeQualificationSchema.safeParse(credentialInput(data));
  if (!parsed.success) return fail(path, message(parsed.error));
  const parsedData = parsed.data;
  const organization = await getCurrentOrganization();
  const [employee, type] = await Promise.all([
    prisma.employee.findFirst({ where: { id: employeeId, organizationId: organization.id } }),
    prisma.qualificationType.findFirst({ where: { id: parsedData.qualificationTypeId, organizationId: organization.id, active: true } }),
  ]);
  if (!employee || !type) return fail(`/people/${employeeId}`, "Employee or qualification type was not found.");
  let expirationDate = parsedData.expirationDate;
  if (type.expirationBehavior === "DOES_NOT_EXPIRE") expirationDate = null;
  if (type.expirationBehavior === "CALCULATED") {
    if (!parsedData.issueDate || !type.defaultValidityMonths) return fail(path, "An issue date is required to calculate expiration.");
    expirationDate = calculateExpirationDate(parsedData.issueDate, type.defaultValidityMonths);
  }
  const payload = { ...parsedData, expirationDate };
  if (id) {
    const existing = await prisma.employeeQualification.findFirst({ where: { id, employeeId, organizationId: organization.id } });
    if (!existing) fail(`/people/${employeeId}`, "Qualification record was not found.");
    await prisma.$transaction(async (tx) => {
      const updated = await tx.employeeQualification.update({ where: { id }, data: { ...payload, verificationStatus: "UNVERIFIED", verifiedAt: null, verifiedByUserId: null, verificationNote: null } });
      await audit.record(tx, {
        organizationId: organization.id, actor: userActor(editor), action: AUDIT_ACTIONS.qualificationUpdated, entityType: "EmployeeQualification", entityId: id,
        summary: `${type.name} updated for ${employee.firstName} ${employee.lastName}; resubmitted for verification`,
        changes: diffChanges(existing, updated, QUALIFICATION_AUDIT_FIELDS), metadata: { employeeId },
      });
    });
  } else {
    await prisma.$transaction(async (tx) => {
      const created = await tx.employeeQualification.create({ data: { ...payload, organizationId: organization.id } });
      await audit.record(tx, {
        organizationId: organization.id, actor: userActor(editor), action: AUDIT_ACTIONS.qualificationAdded, entityType: "EmployeeQualification", entityId: created.id,
        summary: `${type.name} added for ${employee.firstName} ${employee.lastName}`,
        metadata: { employeeId, qualificationTypeId: type.id, expirationDate: created.expirationDate },
      });
    });
  }
  redirect(`/people/${employeeId}?success=Qualification saved and submitted for verification.`);
}

export async function reviewQualification(data: FormData) {
  const id = value(data, "id"); const employeeId = value(data, "employeeId");
  const user = await requireEmployeeEditor(employeeId);
  const rawStatus = value(data, "status");
  if (rawStatus !== "VERIFIED" && rawStatus !== "REJECTED") fail(`/people/${employeeId}`, "Invalid review status.");
  const organization = await getCurrentOrganization();
  const status = rawStatus as "VERIFIED" | "REJECTED";
  await prisma.$transaction(async (tx) => {
    const result = await tx.employeeQualification.updateMany({ where: { id, employeeId, organizationId: organization.id }, data: { verificationStatus: status, verifiedAt: new Date(), verifiedByUserId: user.id, verificationNote: value(data, "verificationNote") || null } });
    if (!result.count) return;
    const held = await tx.employeeQualification.findUniqueOrThrow({ where: { id }, select: { qualificationType: { select: { name: true } } } });
    await audit.record(tx, {
      organizationId: organization.id, actor: userActor(user), action: status === "VERIFIED" ? AUDIT_ACTIONS.qualificationVerified : AUDIT_ACTIONS.qualificationRejected,
      entityType: "EmployeeQualification", entityId: id, summary: `${held.qualificationType.name} ${status === "VERIFIED" ? "verified" : "rejected"}`, metadata: { employeeId },
    });
  });
  redirect(`/people/${employeeId}?success=Verification status updated.`);
}

export async function archiveEmployeeQualification(data: FormData) {
  const id = value(data, "id"); const employeeId = value(data, "employeeId");
  const user = await requireEmployeeEditor(employeeId);
  const organization = await getCurrentOrganization();
  await prisma.$transaction(async (tx) => {
    const result = await tx.employeeQualification.updateMany({ where: { id, employeeId, organizationId: organization.id, archivedAt: null }, data: { archivedAt: new Date() } });
    if (!result.count) return;
    const held = await tx.employeeQualification.findUniqueOrThrow({ where: { id }, select: { qualificationType: { select: { name: true } } } });
    await audit.record(tx, { organizationId: organization.id, actor: userActor(user), action: AUDIT_ACTIONS.qualificationArchived, entityType: "EmployeeQualification", entityId: id, summary: `${held.qualificationType.name} archived`, metadata: { employeeId } });
  });
  redirect(`/people/${employeeId}?success=Qualification archived.`);
}

export async function savePositionRequirement(data: FormData) {
  await requireRole("ADMIN");
  const parsed = requirementSchema.safeParse({ positionId: value(data, "positionId"), qualificationTypeId: value(data, "qualificationTypeId"), required: value(data, "required") === "true", notes: value(data, "notes") });
  const path = `/administration/positions/${value(data, "positionId")}/edit`;
  if (!parsed.success) return fail(path, message(parsed.error));
  const parsedData = parsed.data;
  const organization = await getCurrentOrganization();
  const [position, type] = await Promise.all([prisma.position.findFirst({ where: { id: parsedData.positionId, organizationId: organization.id } }), prisma.qualificationType.findFirst({ where: { id: parsedData.qualificationTypeId, organizationId: organization.id } })]);
  if (!position || !type) return fail(path, "Position or qualification type was not found.");
  await prisma.positionQualificationRequirement.upsert({ where: { positionId_qualificationTypeId: { positionId: position.id, qualificationTypeId: type.id } }, update: { required: parsedData.required, notes: parsedData.notes }, create: { ...parsedData, organizationId: organization.id } });
  redirect(`${path}?success=Qualification requirement saved.`);
}

export async function removePositionRequirement(data: FormData) {
  await requireRole("ADMIN");
  const id = value(data, "id"); const positionId = value(data, "positionId"); const organization = await getCurrentOrganization();
  await prisma.positionQualificationRequirement.deleteMany({ where: { id, positionId, organizationId: organization.id } });
  redirect(`/administration/positions/${positionId}/edit?success=Requirement removed.`);
}

export async function updateQualificationSettings(data: FormData) {
  await requireRole("ADMIN");
  const days = Number(value(data, "warningDays"));
  if (!Number.isInteger(days) || days < 1 || days > 365) fail("/administration/qualifications", "Warning threshold must be 1–365 days.");
  const organization = await getCurrentOrganization();
  await prisma.organization.update({ where: { id: organization.id }, data: { qualificationExpirationWarningDays: days } });
  redirect("/administration/qualifications?success=Expiration warning threshold updated.");
}
