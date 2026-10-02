import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { SESSION_COOKIE_NAME } from "./constants";

const SESSION_HOURS = 8;

function secret() {
  const value = process.env.AUTH_SECRET;
  if ((!value || value.length < 32) && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must contain at least 32 characters in production.");
  }
  return value || "development-only-auth-secret-change-before-production";
}
function tokenHash(token: string) { return createHmac("sha256", secret()).update(token).digest("hex"); }
export function normalizeEmail(email: string) { return email.trim().toLowerCase(); }

export type AuthenticatedUser = {
  id: string; organizationId: string; employeeId: string | null; email: string;
  role: UserRole; mustChangePassword: boolean; displayName: string;
};

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await prisma.session.create({ data: { tokenHash: tokenHash(token), userId, expiresAt } });
  (await cookies()).set(SESSION_COOKIE_NAME, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  store.delete(SESSION_COOKIE_NAME);
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: { user: { include: { employee: { select: { firstName: true, preferredName: true, lastName: true } } } } },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.active) {
    if (session) await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  const { user } = session;
  const displayName = user.employee
    ? `${user.employee.preferredName || user.employee.firstName} ${user.employee.lastName}`
    : user.email;
  return { id: user.id, organizationId: user.organizationId, employeeId: user.employeeId, email: user.email,
    role: user.role, mustChangePassword: user.mustChangePassword, displayName };
}

export async function requireAuthenticatedUser() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  return user;
}
export async function requireRole(...roles: UserRole[]) {
  const user = await requireAuthenticatedUser();
  if (!roles.includes(user.role)) redirect("/forbidden");
  return user;
}
export async function canViewEmployee(user: AuthenticatedUser, employeeId: string) {
  return user.role !== "EMPLOYEE" || user.employeeId === employeeId;
}
export async function canEditEmployee(user: AuthenticatedUser, employeeId: string) {
  if (user.role === "ADMIN") return true;
  if (user.role !== "MANAGER" || !user.employeeId) return false;
  return Boolean(await prisma.employee.findFirst({ where: { id: employeeId, organizationId: user.organizationId, supervisorId: user.employeeId }, select: { id: true } }));
}
export function canManageUsers(user: AuthenticatedUser) { return user.role === "ADMIN"; }
