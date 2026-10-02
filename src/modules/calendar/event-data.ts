import type { AuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { clientVisibilityWhere } from "@/modules/clients/authorization";
import { projectVisibilityWhere } from "@/modules/projects/authorization";
import { canAssignOthers, canPublishOrganizationEvents } from "./authorization";

/** Link pickers only offer records the user is already allowed to see. */
export async function eventFormOptions(user: AuthenticatedUser) {
  const assignOthers = canAssignOthers(user);
  const [projects, clients, employees] = await Promise.all([
    prisma.project.findMany({ where: projectVisibilityWhere(user), select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
    prisma.client.findMany({ where: clientVisibilityWhere(user), select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
    prisma.employee.findMany({
      where: { organizationId: user.organizationId, employmentStatus: { not: "TERMINATED" }, ...(assignOthers ? {} : { id: user.employeeId ?? "__none__" }) },
      select: { id: true, firstName: true, preferredName: true, lastName: true, suffix: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 500,
    }),
  ]);
  return { projects, clients, employees, canPublish: canPublishOrganizationEvents(user), canAssign: assignOthers };
}
