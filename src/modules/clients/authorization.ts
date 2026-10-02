import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedUser } from "@/lib/auth/session";

/** Visibility is always organization-scoped. Non-admins need ownership or a visible project relationship. */
export function clientVisibilityWhere(user: AuthenticatedUser): Prisma.ClientWhereInput {
  if (user.role === "ADMIN") return { organizationId: user.organizationId };
  const projectAccess: Prisma.ProjectWhereInput = user.employeeId ? { OR: [
    { projectManagerId: user.employeeId },
    { members: { some: { employeeId: user.employeeId, leftAt: null } } },
  ] } : { id: "__none__" };
  return { organizationId: user.organizationId, OR: [
    ...(user.role === "MANAGER" ? [{ createdByUserId: user.id }] : []),
    { projects: { some: projectAccess } },
  ] };
}
export function canEditClient(user: AuthenticatedUser, client: { createdByUserId: string; projects: { projectManagerId: string | null }[] }) {
  return user.role === "ADMIN" || (user.role === "MANAGER" && (client.createdByUserId === user.id || client.projects.some(p => p.projectManagerId === user.employeeId)));
}
