"use server";
import { redirect } from "next/navigation";
import { getCurrentOrganization } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession, normalizeEmail, requireAuthenticatedUser } from "./session";
import { hashPassword, validatePassword, verifyPassword } from "./password";

export async function login(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") || ""));
  const password = String(formData.get("password") || "");
  const organization = await getCurrentOrganization();
  const user = await prisma.user.findUnique({ where: { organizationId_email: { organizationId: organization.id, email } } });
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) redirect("/login?error=Invalid%20email%20or%20password.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
  ]);
  await createSession(user.id);
  redirect(user.mustChangePassword ? "/account?required=1" : "/");
}
export async function logout() { await destroySession(); redirect("/login"); }
export async function changePassword(formData: FormData) {
  const current = String(formData.get("currentPassword") || "");
  const next = String(formData.get("newPassword") || "");
  const confirmation = String(formData.get("confirmPassword") || "");
  const user = await requireAuthenticatedUser();
  const error = validatePassword(next);
  if (error) redirect(`/account?error=${encodeURIComponent(error)}`);
  if (next !== confirmation) redirect("/account?error=New%20passwords%20do%20not%20match.");
  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await verifyPassword(current, record.passwordHash))) redirect("/account?error=Current%20password%20is%20incorrect.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
  await createSession(user.id);
  redirect("/account?success=Password%20changed.");
}
