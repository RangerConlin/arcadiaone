import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedUser } from "@/lib/auth/session";

/** Central document visibility policy; every branch remains organization scoped. */
export function documentVisibilityWhere(user: AuthenticatedUser): Prisma.DocumentWhereInput {
  const organizationId = user.organizationId;
  if (user.role === "ADMIN") return { organizationId };
  const employeeId = user.employeeId || "__none__";
  const project = { OR: [{ projectManagerId: employeeId }, { members: { some: { employeeId, leftAt: null } } }] };
  const normalRelations: Prisma.DocumentRelationWhereInput[] = [
    { project: project },
    { task: { OR: [{ assignedToEmployeeId: employeeId }, { createdByUserId: user.id }, { project }] } },
    { client: { OR: [{ createdByUserId: user.id }, { projects: { some: project } }] } },
    { rental: { OR: [{ createdByUserId: user.id }, { project }] } },
    { equipmentId: { not: null } },
    { employeeId },
    { employeeQualification: { employeeId } },
  ];
  return {
    organizationId,
    sensitivity: user.role === "MANAGER" ? undefined : "NORMAL",
    relations: { some: { organizationId, OR: normalRelations } },
  };
}

export const canCreateDocuments = (user: AuthenticatedUser) => user.role === "ADMIN" || user.role === "MANAGER";
export const canManageDocument = (user: AuthenticatedUser, document: { createdByUserId: string }) =>
  user.role === "ADMIN" || (user.role === "MANAGER" && document.createdByUserId === user.id);
