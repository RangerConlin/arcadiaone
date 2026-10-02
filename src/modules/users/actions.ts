"use server";
import { redirect } from "next/navigation";
import { UserRole } from "@/generated/prisma/enums";
import { hashPassword, validatePassword } from "@/lib/auth/password";
import { normalizeEmail, requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { audit, userActor } from "@/modules/audit/service";

function value(data: FormData, key: string) { return String(data.get(key) || "").trim(); }
function fail(path: string, message: string): never { redirect(`${path}?error=${encodeURIComponent(message)}`); }
function roleValue(input: string): UserRole | null { return Object.values(UserRole).includes(input as UserRole) ? input as UserRole : null; }

export async function createUser(formData: FormData) {
  const admin = await requireRole("ADMIN");
  const email = normalizeEmail(value(formData, "email")); const password = String(formData.get("password") || "");
  const employeeId = value(formData, "employeeId") || null; const role = roleValue(value(formData, "role"));
  if (!email || !email.includes("@")) fail("/administration/users/new", "Enter a valid email address.");
  const passwordError = validatePassword(password); if (passwordError) fail("/administration/users/new", passwordError);
  if (!role) fail("/administration/users/new", "Select a valid role.");
  if (employeeId && !await prisma.employee.findFirst({ where: { id: employeeId, organizationId: admin.organizationId } })) fail("/administration/users/new", "Selected employee was not found.");
  try {
    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { organizationId: admin.organizationId, employeeId, email, role, passwordHash, mustChangePassword: true } });
      await audit.record(tx, { organizationId: admin.organizationId, actor: userActor(admin), action: AUDIT_ACTIONS.userCreated, entityType: "User", entityId: created.id, summary: `User ${email} created with role ${role}`, metadata: { role, employeeId } });
    });
  } catch { fail("/administration/users/new", "The user could not be created. Check that the email and employee are not already linked."); }
  redirect("/administration/users?success=User%20created.%20Share%20the%20temporary%20password%20securely.");
}
export async function updateUser(formData: FormData) {
  const admin = await requireRole("ADMIN"); const id = value(formData, "id");
  const role = roleValue(value(formData, "role")); const active = value(formData, "active") === "true";
  if (!role) fail(`/administration/users/${id}`, "Select a valid role.");
  if (id === admin.id && (!active || role !== "ADMIN")) fail(`/administration/users/${id}`, "You cannot remove your own active administrator access.");
  const existing = await prisma.user.findFirst({ where: { id, organizationId: admin.organizationId }, select: { role: true, active: true, email: true } });
  if (!existing) fail("/administration/users", "User was not found.");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { role, active } });
    if (!active) await tx.session.deleteMany({ where: { userId: id } });
    const base = { organizationId: admin.organizationId, actor: userActor(admin), entityType: "User" as const, entityId: id };
    if (existing!.role !== role) await audit.record(tx, { ...base, action: AUDIT_ACTIONS.userRoleChanged, summary: `Role for ${existing!.email} changed from ${existing!.role} to ${role}`, changes: [{ field: "role", from: existing!.role, to: role }] });
    if (existing!.active !== active) await audit.record(tx, { ...base, action: active ? AUDIT_ACTIONS.userActivated : AUDIT_ACTIONS.userDeactivated, summary: `Account ${existing!.email} ${active ? "activated" : "deactivated"}` });
  });
  redirect(`/administration/users/${id}?success=User%20updated.`);
}
export async function resetUserPassword(formData: FormData) {
  const admin = await requireRole("ADMIN"); const id = value(formData, "id"); const password = String(formData.get("password") || "");
  const error = validatePassword(password); if (error) fail(`/administration/users/${id}`, error);
  const target = await prisma.user.findFirst({ where: { id, organizationId: admin.organizationId }, select: { email: true } });
  if (!target) fail("/administration/users", "User was not found.");
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
    await tx.session.deleteMany({ where: { userId: id } });
    await audit.record(tx, { organizationId: admin.organizationId, actor: userActor(admin), action: AUDIT_ACTIONS.authPasswordReset, entityType: "User", entityId: id, summary: `Temporary password assigned to ${target!.email}; sessions revoked` });
  });
  redirect(`/administration/users/${id}?success=Temporary%20password%20assigned.%20Existing%20sessions%20were%20revoked.`);
}
