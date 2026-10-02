import type { Prisma } from "@/generated/prisma/client";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { taskVisibilityWhere } from "./authorization";
import { CLOSED_TASK_STATUSES, DUE_SOON_DAYS } from "./constants";

export const taskInclude = {
  assignedTo: true, project: true, milestone: true, parentTask: true,
} satisfies Prisma.TaskInclude;

export async function getTaskOptions() {
  const actor = await requireAuthenticatedUser();
  const [employees, projects] = await Promise.all([
    prisma.employee.findMany({ where: { organizationId: actor.organizationId, employmentStatus: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
    prisma.project.findMany({ where: { organizationId: actor.organizationId }, include: { milestones: { orderBy: { sortOrder: "asc" } } }, orderBy: { name: "asc" } }),
  ]);
  return { actor, employees, projects };
}

export async function listTasks(searchParams: Record<string, string | string[] | undefined>, projectId?: string) {
  const actor = await requireAuthenticatedUser();
  const value = (key: string) => typeof searchParams[key] === "string" ? searchParams[key] as string : "";
  const page = Math.max(1, Number(value("page")) || 1); const pageSize = 25;
  const filters: Prisma.TaskWhereInput[] = [taskVisibilityWhere(actor), { parentTaskId: null }];
  if (projectId) filters.push({ projectId });
  if (value("q")) filters.push({ OR: [{ title: { contains: value("q"), mode: "insensitive" } }, { description: { contains: value("q"), mode: "insensitive" } }] });
  if (value("status")) filters.push({ status: value("status") as never });
  if (value("priority")) filters.push({ priority: value("priority") as never });
  if (value("project")) filters.push({ projectId: value("project") });
  if (value("assignee")) filters.push({ assignedToEmployeeId: value("assignee") });
  if (value("milestone")) filters.push({ milestoneId: value("milestone") });
  if (value("scope") === "mine") filters.push({ assignedToEmployeeId: actor.employeeId ?? "__none__" });
  const now = new Date();
  if (value("due") === "overdue") filters.push({ dueDate: { lt: now }, status: { notIn: [...CLOSED_TASK_STATUSES] } });
  if (value("due") === "soon") { const end = new Date(now); end.setDate(end.getDate() + DUE_SOON_DAYS); filters.push({ dueDate: { gte: now, lte: end }, status: { notIn: [...CLOSED_TASK_STATUSES] } }); }
  const where = { AND: filters };
  const [tasks, total] = await prisma.$transaction([
    prisma.task.findMany({ where, include: taskInclude, orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.task.count({ where }),
  ]);
  return { actor, tasks, total, page, pageSize };
}

export async function getTaskDetail(id: string) {
  const actor = await requireAuthenticatedUser();
  return prisma.task.findFirst({ where: { id, ...taskVisibilityWhere(actor) }, include: {
    ...taskInclude, createdBy: { include: { employee: true } },
    subtasks: { include: { assignedTo: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    checklistItems: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    comments: { include: { user: { include: { employee: true } } }, orderBy: { createdAt: "desc" } },
    activities: { include: { user: { include: { employee: true } } }, orderBy: { createdAt: "desc" }, take: 50 },
  }});
}

export async function getTaskDashboardStats() {
  const actor = await requireAuthenticatedUser(); const visible = taskVisibilityWhere(actor); const now = new Date(); const soon = new Date(now); soon.setDate(soon.getDate() + DUE_SOON_DAYS);
  const mine = actor.employeeId ? { assignedToEmployeeId: actor.employeeId } : { createdByUserId: actor.id };
  const [open, dueSoon, overdue, inProgress] = await prisma.$transaction([
    prisma.task.count({ where: { AND: [visible, mine, { status: { notIn: [...CLOSED_TASK_STATUSES] } }] } }),
    prisma.task.count({ where: { AND: [visible, mine, { dueDate: { gte: now, lte: soon }, status: { notIn: [...CLOSED_TASK_STATUSES] } }] } }),
    prisma.task.count({ where: { AND: [visible, mine, { dueDate: { lt: now }, status: { notIn: [...CLOSED_TASK_STATUSES] } }] } }),
    prisma.task.count({ where: { AND: [visible, mine, { status: "IN_PROGRESS" }] } }),
  ]);
  return { open, dueSoon, overdue, inProgress };
}
