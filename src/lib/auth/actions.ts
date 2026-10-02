"use server";
import { redirect } from "next/navigation";
import { getCurrentOrganization } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession, getAuthenticatedUser, normalizeEmail, requireAuthenticatedUser } from "./session";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { audit, userActor } from "@/modules/audit/service";
import { hashPassword, validatePassword, verifyPassword } from "./password";

const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
const LOGIN_FAILURE_LOG_LIMIT = 20;

/** Records a failed login without credentials; volume-limited per attempted address so it cannot be flooded. */
async function recordLoginFailure(organizationId: string, email: string, user: { id: string } | null, reason: "unknown_user" | "inactive_user" | "bad_password") {
  const label = email.includes("@") && email.length <= 200 ? email : null; // never store something that may be a typed password
  if (label) {
    const recent = await prisma.auditEvent.count({ where: { organizationId, action: AUDIT_ACTIONS.authLoginFailure, actorLabel: label, occurredAt: { gt: new Date(Date.now() - LOGIN_FAILURE_WINDOW_MS) } } });
    if (recent >= LOGIN_FAILURE_LOG_LIMIT) return;
  }
  await audit.recordStandalone({
    organizationId, actor: { userId: user?.id ?? null, label }, action: AUDIT_ACTIONS.authLoginFailure, entityType: "User", entityId: user?.id ?? null,
    outcome: "FAILURE", summary: "Failed login attempt", metadata: { reason },
  });
}

export async function login(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") || ""));
  const password = String(formData.get("password") || "");
  const organization = await getCurrentOrganization();
  const user = await prisma.user.findUnique({ where: { organizationId_email: { organizationId: organization.id, email } } });
  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !user.active || !passwordOk) {
    await recordLoginFailure(organization.id, email, user, !user ? "unknown_user" : !user.active ? "inactive_user" : "bad_password");
    redirect("/login?error=Invalid%20email%20or%20password.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await tx.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.authLoginSuccess, entityType: "User", entityId: user.id, summary: `${user.email} signed in` });
  });
  await createSession(user.id);
  redirect(user.mustChangePassword ? "/account?required=1" : "/");
}
export async function logout() {
  const user = await getAuthenticatedUser();
  await destroySession();
  if (user) await audit.recordStandalone({ organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.authLogout, entityType: "User", entityId: user.id, summary: `${user.email} signed out` });
  redirect("/login");
}
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
  const passwordHash = await hashPassword(next);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.authPasswordChanged, entityType: "User", entityId: user.id, summary: "Password changed; other sessions revoked" });
  });
  await createSession(user.id);
  redirect("/account?success=Password%20changed.");
}
