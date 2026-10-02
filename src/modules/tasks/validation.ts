import { z } from "zod";
import { TASK_PRIORITIES, TASK_STATUSES } from "./constants";

const optionalId = z.string().trim().transform((value) => value || null).nullable();
const optionalDate = z.string().trim().transform((value) => value ? new Date(`${value}T12:00:00.000Z`) : null);

export const taskSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
  description: z.string().trim().max(5000).transform((value) => value || null),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  assignedToEmployeeId: optionalId,
  projectId: optionalId,
  milestoneId: optionalId,
  parentTaskId: optionalId,
  startDate: optionalDate,
  dueDate: optionalDate,
}).refine((value) => !value.startDate || !value.dueDate || value.startDate <= value.dueDate, {
  message: "Due date must be on or after the start date.",
});

export function taskInput(formData: FormData) {
  const value = (key: string) => String(formData.get(key) ?? "");
  return {
    title: value("title"), description: value("description"), status: value("status") || "TODO",
    priority: value("priority") || "NORMAL", assignedToEmployeeId: value("assignedToEmployeeId"),
    projectId: value("projectId"), milestoneId: value("milestoneId"), parentTaskId: value("parentTaskId"),
    startDate: value("startDate"), dueDate: value("dueDate"),
  };
}
