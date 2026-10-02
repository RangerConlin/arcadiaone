export const DUE_SOON_DAYS = 7;
export const CLOSED_TASK_STATUSES = ["COMPLETED", "CANCELLED"] as const;

export const TASK_STATUSES = [
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
] as const;

export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export function isOverdue(
  task: { dueDate: Date | null; status: string },
  now = new Date(),
) {
  return Boolean(
    task.dueDate &&
      task.dueDate.getTime() < now.getTime() &&
      !CLOSED_TASK_STATUSES.includes(
        task.status as (typeof CLOSED_TASK_STATUSES)[number],
      ),
  );
}

export function isDueSoon(
  task: { dueDate: Date | null; status: string },
  now = new Date(),
) {
  if (!task.dueDate || CLOSED_TASK_STATUSES.includes(task.status as never)) {
    return false;
  }
  const end = new Date(now);
  end.setDate(end.getDate() + DUE_SOON_DAYS);
  return task.dueDate >= now && task.dueDate <= end;
}
