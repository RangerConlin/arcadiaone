"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageTask, requireTaskAccess } from "./authorization";
import { taskInput, taskSchema } from "./validation";

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const fail = (path: string, message: string): never => redirect(`${path}?error=${encodeURIComponent(message)}`);

async function validateRelations(data: ReturnType<typeof taskSchema.parse>, organizationId: string, taskId?: string) {
  const [employee, project, milestone, parent] = await Promise.all([
    data.assignedToEmployeeId ? prisma.employee.findFirst({ where: { id: data.assignedToEmployeeId, organizationId } }) : null,
    data.projectId ? prisma.project.findFirst({ where: { id: data.projectId, organizationId } }) : null,
    data.milestoneId ? prisma.projectMilestone.findFirst({ where: { id: data.milestoneId, project: { organizationId } } }) : null,
    data.parentTaskId ? prisma.task.findFirst({ where: { id: data.parentTaskId, organizationId }, include: { parentTask: true } }) : null,
  ]);
  if (data.assignedToEmployeeId && !employee) throw new Error("Assignee is not in your organization.");
  if (data.projectId && !project) throw new Error("Project is not in your organization.");
  if (data.milestoneId && (!milestone || milestone.projectId !== data.projectId)) throw new Error("Milestone must belong to the selected project.");
  if (data.parentTaskId && (!parent || parent.id === taskId || parent.parentTaskId || parent.projectId !== data.projectId)) {
    throw new Error("A subtask requires a top-level parent in the same project and cannot create a cycle.");
  }
  if (taskId && data.parentTaskId) {
    const hasChildren = await prisma.task.findFirst({ where: { parentTaskId: taskId }, select: { id: true } });
    if (hasChildren) throw new Error("A task with subtasks cannot also become a subtask.");
  }
}

export async function createTask(formData: FormData) {
  const actor = await requireCurrentUser();
  if (actor.role === "EMPLOYEE") fail("/tasks/new", "You do not have permission to create tasks.");
  const parsed = taskSchema.safeParse(taskInput(formData));
  if (!parsed.success) fail("/tasks/new", parsed.error.issues[0]?.message ?? "Invalid task.");
  const data = parsed.data!;
  let taskId = "";
  try {
    await validateRelations(data, actor.organizationId);
    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({ data: {
        ...data, organizationId: actor.organizationId, createdByUserId: actor.id,
        assignedByUserId: data.assignedToEmployeeId ? actor.id : null,
        completedAt: data.status === "COMPLETED" ? new Date() : null,
      }});
      await tx.taskActivity.create({ data: { organizationId: actor.organizationId, taskId: created.id, userId: actor.id, type: "CREATED" } });
      return created;
    });
    taskId = task.id;
  } catch (error) {
    fail("/tasks/new", error instanceof Error ? error.message : "Task could not be created.");
  }
  redirect(`/tasks/${taskId}?success=Task created.`);
}

export async function updateTask(formData: FormData) {
  const actor = await requireCurrentUser();
  const id = text(formData, "id");
  const existing = await requireTaskAccess(id, actor);
  const parsed = taskSchema.safeParse(taskInput(formData));
  if (!parsed.success) fail(`/tasks/${id}`, parsed.error.issues[0]?.message ?? "Invalid task.");
  const data = parsed.data!;
  const manager = canManageTask(actor, existing);
  if (!manager) {
    if (existing.assignedToEmployeeId !== actor.employeeId) fail(`/tasks/${id}`, "You cannot edit this task.");
    if (data.assignedToEmployeeId !== existing.assignedToEmployeeId || data.projectId !== existing.projectId || data.title !== existing.title || data.description !== existing.description || data.priority !== existing.priority || data.milestoneId !== existing.milestoneId || data.startDate?.getTime() !== existing.startDate?.getTime() || data.dueDate?.getTime() !== existing.dueDate?.getTime() || data.parentTaskId !== existing.parentTaskId) {
      fail(`/tasks/${id}`, "Employees may update assigned task status, checklist progress, and comments, but cannot change task details or assignment.");
    }
  }
  try {
    await validateRelations(data, actor.organizationId, id);
    await prisma.$transaction(async (tx) => {
      await tx.task.update({ where: { id }, data: {
        ...data,
        completedAt: data.status === "COMPLETED" ? existing.completedAt ?? new Date() : null,
        assignedByUserId: data.assignedToEmployeeId !== existing.assignedToEmployeeId ? actor.id : existing.assignedByUserId,
      }});
      const events: Array<{ type: "STATUS_CHANGED" | "ASSIGNEE_CHANGED" | "DUE_DATE_CHANGED" | "COMPLETED" | "REOPENED" | "UPDATED"; detail?: string }> = [];
      if (existing.status !== data.status) events.push({ type: data.status === "COMPLETED" ? "COMPLETED" : existing.status === "COMPLETED" ? "REOPENED" : "STATUS_CHANGED", detail: `${existing.status} → ${data.status}` });
      if (existing.assignedToEmployeeId !== data.assignedToEmployeeId) events.push({ type: "ASSIGNEE_CHANGED" });
      if (existing.dueDate?.getTime() !== data.dueDate?.getTime()) events.push({ type: "DUE_DATE_CHANGED" });
      if (!events.length) events.push({ type: "UPDATED" });
      await tx.taskActivity.createMany({ data: events.map((event) => ({ ...event, organizationId: actor.organizationId, taskId: id, userId: actor.id })) });
    });
  } catch (error) { fail(`/tasks/${id}`, error instanceof Error ? error.message : "Task could not be updated."); }
  redirect(`/tasks/${id}?success=Task updated.`);
}

export async function addChecklistItem(formData: FormData) {
  const actor = await requireCurrentUser(); const taskId = text(formData, "taskId"); const itemText = text(formData, "text");
  await requireTaskAccess(taskId, actor); if (!itemText) fail(`/tasks/${taskId}`, "Checklist text is required.");
  await prisma.$transaction(async (tx) => {
    await tx.taskChecklistItem.create({ data: { taskId, text: itemText.slice(0, 300) } });
    await tx.taskActivity.create({ data: { organizationId: actor.organizationId, taskId, userId: actor.id, type: "CHECKLIST_CHANGED", detail: "Checklist item added" } });
  });
  revalidatePath(`/tasks/${taskId}`);
}

export async function toggleChecklistItem(formData: FormData) {
  const actor = await requireCurrentUser(); const taskId = text(formData, "taskId"); const id = text(formData, "id");
  await requireTaskAccess(taskId, actor);
  const item = await prisma.taskChecklistItem.findFirst({ where: { id, taskId, task: { organizationId: actor.organizationId } } });
  if (!item) fail(`/tasks/${taskId}`, "Checklist item was not found.");
  await prisma.taskChecklistItem.update({ where: { id }, data: { completed: !item!.completed } }); revalidatePath(`/tasks/${taskId}`);
}

export async function addTaskComment(formData: FormData) {
  const actor = await requireCurrentUser(); const taskId = text(formData, "taskId"); const content = text(formData, "content");
  await requireTaskAccess(taskId, actor); if (!content) fail(`/tasks/${taskId}`, "Comment cannot be empty.");
  await prisma.$transaction(async (tx) => {
    await tx.taskComment.create({ data: { organizationId: actor.organizationId, taskId, userId: actor.id, content: content.slice(0, 5000) } });
    await tx.taskActivity.create({ data: { organizationId: actor.organizationId, taskId, userId: actor.id, type: "COMMENT_ADDED" } });
  });
  revalidatePath(`/tasks/${taskId}`);
}
