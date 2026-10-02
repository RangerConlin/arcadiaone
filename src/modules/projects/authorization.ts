import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { requireAuthenticatedUser, requireRole, type AuthenticatedUser } from "@/lib/auth/session";

export function canManageProject(user: AuthenticatedUser, project: { projectManagerId: string | null }) {
  if (user.role === "ADMIN") return true;
  return user.role === "MANAGER" && Boolean(user.employeeId) && user.employeeId === project.projectManagerId;
}

/** ADMIN sees every project in the organization; others see projects they manage or actively belong to. */
export function projectVisibilityWhere(user: AuthenticatedUser): Prisma.ProjectWhereInput {
  if (user.role === "ADMIN") return { organizationId: user.organizationId };
  if (!user.employeeId) return { id: "__no_authorized_projects__" };
  return {
    organizationId: user.organizationId,
    OR: [{ projectManagerId: user.employeeId }, { members: { some: { employeeId: user.employeeId, leftAt: null } } }],
  };
}

export const requireAdmin = () => requireRole("ADMIN");
export const requireCreateProject = () => requireRole("ADMIN", "MANAGER");

export async function requireProjectManagement(project: { projectManagerId: string | null }) {
  const user = await requireAuthenticatedUser();
  if (!canManageProject(user, project)) redirect("/forbidden");
  return user;
}
