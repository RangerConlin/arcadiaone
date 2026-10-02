import type { Prisma, UserRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type Actor = { id: string; organizationId: string; employeeId: string | null; role: UserRole };

export function taskVisibilityWhere(actor: Actor): Prisma.TaskWhereInput {
  if (actor.role === "ADMIN") return { organizationId: actor.organizationId };
  if (actor.role === "MANAGER") {
    return {
      organizationId: actor.organizationId,
      OR: [
        { assignedToEmployeeId: actor.employeeId ?? "__none__" },
        { createdByUserId: actor.id },
        { project: { projectManagerId: actor.employeeId ?? "__none__" } },
        { project: { members: { some: { employeeId: actor.employeeId ?? "__none__", leftAt: null } } } },
        { projectId: null, createdByUserId: actor.id },
      ],
    };
  }
  return {
    organizationId: actor.organizationId,
    OR: [
      { assignedToEmployeeId: actor.employeeId ?? "__none__" },
      { project: { members: { some: { employeeId: actor.employeeId ?? "__none__", leftAt: null } } } },
    ],
  };
}

export async function requireTaskAccess(taskId: string, actor: Actor) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, ...taskVisibilityWhere(actor) },
    include: { project: true },
  });
  if (!task) throw new Error("Task not found or access denied.");
  return task;
}

export function canManageTask(actor: Actor, task: { createdByUserId: string; project: { projectManagerId: string | null } | null }) {
  return actor.role === "ADMIN" || actor.role === "MANAGER" &&
    (task.createdByUserId === actor.id || (actor.employeeId !== null && task.project?.projectManagerId === actor.employeeId));
}
