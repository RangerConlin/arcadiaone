"use server";
import { redirect } from "next/navigation";
import { UserRole } from "@/generated/prisma/enums";
import { hashPassword, validatePassword } from "@/lib/auth/password";
import { normalizeEmail, requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

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
    await prisma.user.create({ data: { organizationId: admin.organizationId, employeeId, email, role, passwordHash: await hashPassword(password), mustChangePassword: true } });
  } catch { fail("/administration/users/new", "The user could not be created. Check that the email and employee are not already linked."); }
  redirect("/administration/users?success=User%20created.%20Share%20the%20temporary%20password%20securely.");
}
export async function updateUser(formData: FormData) {
  const admin = await requireRole("ADMIN"); const id = value(formData, "id");
  const role = roleValue(value(formData, "role")); const active = value(formData, "active") === "true";
  if (!role) fail(`/administration/users/${id}`, "Select a valid role.");
  if (id === admin.id && (!active || role !== "ADMIN")) fail(`/administration/users/${id}`, "You cannot remove your own active administrator access.");
  const result = await prisma.user.updateMany({ where: { id, organizationId: admin.organizationId }, data: { role, active } });
  if (!result.count) fail("/administration/users", "User was not found.");
  if (!active) await prisma.session.deleteMany({ where: { userId: id } });
  redirect(`/administration/users/${id}?success=User%20updated.`);
}
export async function resetUserPassword(formData: FormData) {
  const admin = await requireRole("ADMIN"); const id = value(formData, "id"); const password = String(formData.get("password") || "");
  const error = validatePassword(password); if (error) fail(`/administration/users/${id}`, error);
  const result = await prisma.user.updateMany({ where: { id, organizationId: admin.organizationId }, data: { passwordHash: await hashPassword(password), mustChangePassword: true } });
  if (!result.count) fail("/administration/users", "User was not found.");
  await prisma.session.deleteMany({ where: { userId: id } });
  redirect(`/administration/users/${id}?success=Temporary%20password%20assigned.%20Existing%20sessions%20were%20revoked.`);
}
