import type { ProjectStatus } from "@/generated/prisma/enums";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { projectVisibilityWhere } from "./authorization";
export const projectInclude = { projectManager: { include: { position: true } }, members: { orderBy: { createdAt: "asc" as const }, include: { employee: { include: { position: true } }, projectRole: true } }, milestones: { include: { tasks: { select: { status: true } } }, orderBy: [{ sortOrder: "asc" as const }, { targetDate: "asc" as const }] }, activities: { orderBy: { createdAt: "desc" as const } }, client: true };
export async function listProjects(filters: { search?: string; status?: ProjectStatus; managerId?: string; lifecycle?: string; page?: number }) { const user = await requireAuthenticatedUser(); const page = Math.max(1, filters.page || 1), take = 25, search = filters.search?.trim(); const where = { ...projectVisibilityWhere(user), status: filters.status || (filters.lifecycle === "open" ? { in: ["PLANNING", "ACTIVE", "ON_HOLD"] as ProjectStatus[] } : filters.lifecycle === "closed" ? { in: ["COMPLETED", "CANCELLED", "ARCHIVED"] as ProjectStatus[] } : undefined), projectManagerId: filters.managerId || undefined, ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { projectNumber: { contains: search, mode: "insensitive" as const } }, { clientName: { contains: search, mode: "insensitive" as const } }] } : {}) }; const [items, total] = await Promise.all([prisma.project.findMany({ where, include: { projectManager: true, _count: { select: { tasks: true } } }, orderBy: { updatedAt: "desc" }, skip: (page - 1) * take, take }), prisma.project.count({ where })]); return { items, total, page, pages: Math.max(1, Math.ceil(total / take)) }; }
export async function getProject(id: string) { const user = await requireAuthenticatedUser(); return prisma.project.findFirst({ where: { id, ...projectVisibilityWhere(user) }, include: projectInclude }); }
export async function getProjectOptions() { const o = await requireAuthenticatedUser(); const [employees, roles, clients] = await Promise.all([prisma.employee.findMany({ where: { organizationId: o.organizationId, employmentStatus: { in: ["ACTIVE", "LEAVE"] } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], include: { position: true } }), prisma.projectRole.findMany({ where: { organizationId: o.organizationId, active: true }, orderBy: { name: "asc" } }), prisma.client.findMany({ where: { organizationId: o.organizationId, status: { not: "ARCHIVED" } }, select: { id: true, name: true, displayName: true, clientNumber: true }, orderBy: { name: "asc" } })]); return { employees, roles, clients }; }
export async function listProjectRoles() { const o = await requireAuthenticatedUser(); return prisma.projectRole.findMany({ where: { organizationId: o.organizationId }, include: { _count: { select: { members: true } } }, orderBy: [{ active: "desc" }, { name: "asc" }] }); }
export async function getProjectDashboardStats() {
  const user = await requireAuthenticatedUser();
  const visible = projectVisibilityWhere(user);
  const [active, planning, onHold, upcoming] = await Promise.all([
    prisma.project.count({ where: { ...visible, status: "ACTIVE" } }),
    prisma.project.count({ where: { ...visible, status: "PLANNING" } }),
    prisma.project.count({ where: { ...visible, status: "ON_HOLD" } }),
    prisma.projectMilestone.count({ where: { project: visible, status: { in: ["PENDING", "IN_PROGRESS"] }, targetDate: { gte: new Date(), lte: new Date(Date.now() + 30 * 86400000) } } }),
  ]);
  return { active, planning, onHold, upcoming };
}
