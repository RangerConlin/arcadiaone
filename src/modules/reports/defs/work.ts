import type { Prisma } from "@/generated/prisma/client";
import { dateKeyInZone, dateKeyUtc, diffDays, keyToDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { formatName } from "@/lib/format";
import { projectVisibilityWhere } from "@/modules/projects/authorization";
import { taskVisibilityWhere } from "@/modules/tasks/authorization";
import { dateCell, label, nameCell, OPEN_TASK_STATUSES, pageRows, rangeOrDefault, window } from "../helpers";
import type { Cell, ReportContext, ReportDefinition } from "../types";

const everyone = () => true;
const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED", "ARCHIVED"].map((value) => ({ value, label: value.toLowerCase().replace("_", " ") }));
const TASK_OPEN_STATUSES = OPEN_TASK_STATUSES.map((value) => ({ value, label: value.toLowerCase().replace("_", " ") }));

/** Project scope = the viewer's project visibility plus optional filters. */
function projectWhere(ctx: ReportContext): Prisma.ProjectWhereInput {
  const f = ctx.filters;
  const and: Prisma.ProjectWhereInput[] = [projectVisibilityWhere(ctx.user)];
  if (f.client) and.push({ clientId: f.client });
  if (f.project) and.push({ id: f.project });
  if (f.status) and.push({ status: f.status as never });
  if (f.employee) and.push({ OR: [{ projectManagerId: f.employee }, { members: { some: { employeeId: f.employee, leftAt: null } } }] });
  if (f.department) and.push({ projectManager: { departmentId: f.department } });
  if (f.from || f.to) {
    const startsBeforeEnd = f.to ? [{ OR: [{ startDate: null }, { startDate: { lte: keyToDate(f.to) } }] }] : [];
    const endsAfterStart = f.from ? [{ OR: [{ targetEndDate: null }, { targetEndDate: { gte: keyToDate(f.from) } }] }] : [];
    and.push(...startsBeforeEnd, ...endsAfterStart);
  }
  return { AND: and };
}

/** Task scope = the viewer's task visibility plus optional filters. */
function taskWhere(ctx: ReportContext, extra: Prisma.TaskWhereInput[] = []): Prisma.TaskWhereInput {
  const f = ctx.filters;
  const and: Prisma.TaskWhereInput[] = [taskVisibilityWhere(ctx.user), ...extra];
  if (f.project) and.push({ projectId: f.project });
  if (f.client) and.push({ project: { clientId: f.client } });
  if (f.employee) and.push({ assignedToEmployeeId: f.employee });
  if (f.department) and.push({ assignedTo: { departmentId: f.department } });
  return { AND: and };
}

const taskInclude = { assignedTo: true, project: { select: { name: true } } } satisfies Prisma.TaskInclude;

const projectSummary: ReportDefinition = {
  id: "project-summary", category: "projects", title: "Project summary",
  description: "Projects you can access with client, manager, status, dates and current team size.",
  filters: ["client", "status", "employee", "department", "dateRange"], statusOptions: PROJECT_STATUSES, access: everyone,
  definition: "The date range keeps projects whose start-to-target-end span overlaps it (open-ended projects always overlap). Team size counts active members, excluding the manager unless also a member.",
  async run(ctx) {
    const where = projectWhere(ctx);
    const [rows, total] = await prisma.$transaction([
      prisma.project.findMany({
        where, orderBy: [{ name: "asc" }, { id: "asc" }], ...window(ctx),
        include: { client: { select: { name: true } }, projectManager: true, _count: { select: { members: { where: { leftAt: null } } } } },
      }),
      prisma.project.count({ where }),
    ]);
    return {
      total,
      columns: [{ label: "Project" }, { label: "Client" }, { label: "Manager" }, { label: "Status", type: "status" }, { label: "Priority", type: "status" }, { label: "Start" }, { label: "Target end" }, { label: "Actual end" }, { label: "Team size", type: "number" }],
      rows: rows.map((p) => [p.name, p.client?.name ?? p.clientName, nameCell(p.projectManager), label(p.status), label(p.priority), dateCell(p.startDate), dateCell(p.targetEndDate), dateCell(p.actualEndDate), p._count.members]),
    };
  },
};

const projectWorkload: ReportDefinition = {
  id: "project-workload", category: "projects", title: "Project workload",
  description: "Open, overdue and completed task counts and milestone progress per project.",
  filters: ["client", "employee", "status"], statusOptions: PROJECT_STATUSES, access: everyone,
  definition: "Counts reflect only tasks you are allowed to see. Overdue = open task whose due date is before today. This is a snapshot of counts, not a capacity forecast.",
  async run(ctx) {
    const where = projectWhere(ctx);
    const [projects, total] = await prisma.$transaction([
      prisma.project.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], ...window(ctx), select: { id: true, name: true, status: true, client: { select: { name: true } } } }),
      prisma.project.count({ where }),
    ]);
    const ids = projects.map((p) => p.id);
    const today = keyToDate(ctx.today);
    const visible = taskVisibilityWhere(ctx.user);
    const [taskGroups, overdueGroups, milestoneGroups, lateMilestones] = await Promise.all([
      prisma.task.groupBy({ by: ["projectId", "status"], where: { AND: [visible, { projectId: { in: ids } }] }, _count: { _all: true } }),
      prisma.task.groupBy({ by: ["projectId"], where: { AND: [visible, { projectId: { in: ids }, status: { in: [...OPEN_TASK_STATUSES] }, dueDate: { lt: today } }] }, _count: { _all: true } }),
      prisma.projectMilestone.groupBy({ by: ["projectId", "status"], where: { projectId: { in: ids } }, _count: { _all: true } }),
      prisma.projectMilestone.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, status: { in: ["PENDING", "IN_PROGRESS"] }, targetDate: { lt: today } }, _count: { _all: true } }),
    ]);
    const count = (groups: Array<{ projectId: string | null; status?: string; _count: { _all: number } }>, projectId: string, statuses?: string[]) =>
      groups.filter((g) => g.projectId === projectId && (!statuses || (g.status && statuses.includes(g.status)))).reduce((n, g) => n + g._count._all, 0);
    return {
      total,
      columns: [{ label: "Project" }, { label: "Client" }, { label: "Status", type: "status" }, { label: "Open tasks", type: "number" }, { label: "Overdue tasks", type: "number" }, { label: "Completed tasks", type: "number" }, { label: "Milestones done", type: "number" }, { label: "Milestones open", type: "number" }, { label: "Milestones late", type: "number" }],
      rows: projects.map((p) => [
        p.name, p.client?.name ?? null, label(p.status),
        count(taskGroups, p.id, [...OPEN_TASK_STATUSES]), count(overdueGroups, p.id), count(taskGroups, p.id, ["COMPLETED"]),
        count(milestoneGroups, p.id, ["COMPLETED"]), count(milestoneGroups, p.id, ["PENDING", "IN_PROGRESS"]), count(lateMilestones, p.id),
      ]),
    };
  },
};

const taskColumns = [{ label: "Task" }, { label: "Project" }, { label: "Assignee" }, { label: "Status", type: "status" as const }, { label: "Priority", type: "status" as const }, { label: "Due" }];
const taskRow = (t: Prisma.TaskGetPayload<{ include: typeof taskInclude }>): Cell[] => [t.title, t.project?.name ?? null, nameCell(t.assignedTo), label(t.status), label(t.priority), dateCell(t.dueDate)];

const openTasks: ReportDefinition = {
  id: "open-tasks", category: "tasks", title: "Open tasks",
  description: "Tasks that are not completed or cancelled.",
  filters: ["project", "client", "employee", "department", "status", "dateRange"], statusOptions: TASK_OPEN_STATUSES, access: everyone,
  definition: "The date range filters on due date.",
  async run(ctx) {
    const f = ctx.filters;
    const where = taskWhere(ctx, [
      { status: f.status ? (f.status as never) : { in: [...OPEN_TASK_STATUSES] } },
      ...(f.from ? [{ dueDate: { gte: keyToDate(f.from) } }] : []), ...(f.to ? [{ dueDate: { lte: keyToDate(f.to) } }] : []),
    ]);
    const [rows, total] = await prisma.$transaction([
      prisma.task.findMany({ where, include: taskInclude, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }], ...window(ctx) }),
      prisma.task.count({ where }),
    ]);
    return { total, columns: taskColumns, rows: rows.map(taskRow) };
  },
};

const overdueTasks: ReportDefinition = {
  id: "overdue-tasks", category: "tasks", title: "Overdue tasks",
  description: "Open tasks whose due date has passed.",
  filters: ["project", "client", "employee", "department"], access: everyone,
  definition: "Overdue means due before today in your time zone and not completed or cancelled.",
  async run(ctx) {
    const where = taskWhere(ctx, [{ status: { in: [...OPEN_TASK_STATUSES] } }, { dueDate: { lt: keyToDate(ctx.today) } }]);
    const [rows, total] = await prisma.$transaction([
      prisma.task.findMany({ where, include: taskInclude, orderBy: [{ dueDate: "asc" }, { id: "asc" }], ...window(ctx) }),
      prisma.task.count({ where }),
    ]);
    return {
      total, columns: [...taskColumns, { label: "Days overdue", type: "number" }],
      rows: rows.map((t) => [...taskRow(t), diffDays(dateKeyUtc(t.dueDate!), ctx.today)]),
    };
  },
};

async function tasksGrouped(ctx: ReportContext, by: "assignedToEmployeeId" | "projectId") {
  const range = rangeOrDefault(ctx, 30);
  const base = taskWhere(ctx);
  const today = keyToDate(ctx.today);
  const [open, overdue, completed] = await Promise.all([
    prisma.task.groupBy({ by: [by], where: { AND: [base, { status: { in: [...OPEN_TASK_STATUSES] } }] }, _count: { _all: true } }),
    prisma.task.groupBy({ by: [by], where: { AND: [base, { status: { in: [...OPEN_TASK_STATUSES] }, dueDate: { lt: today } }] }, _count: { _all: true } }),
    prisma.task.groupBy({ by: [by], where: { AND: [base, { status: "COMPLETED", completedAt: { gte: range.fromDate, lt: range.toExclusive } }] }, _count: { _all: true } }),
  ]);
  const keys = new Set([...open, ...overdue, ...completed].map((g) => g[by]));
  const lookup = (groups: typeof open, key: string | null) => groups.find((g) => g[by] === key)?._count._all ?? 0;
  return { range, keys: [...keys], open: (k: string | null) => lookup(open, k), overdue: (k: string | null) => lookup(overdue, k), completed: (k: string | null) => lookup(completed, k) };
}

const byAssignee: ReportDefinition = {
  id: "tasks-by-assignee", category: "tasks", title: "Tasks by assignee",
  description: "Open, overdue and recently completed task counts for each assignee.",
  filters: ["project", "client", "employee", "department", "dateRange"], access: everyone,
  definition: "Completed counts tasks completed in the date range (default: last 30 days). Open and overdue are current snapshots.",
  async run(ctx) {
    const g = await tasksGrouped(ctx, "assignedToEmployeeId");
    const ids = g.keys.filter((k): k is string => Boolean(k));
    const employees = await prisma.employee.findMany({ where: { id: { in: ids }, organizationId: ctx.user.organizationId } });
    const nameOf = new Map(employees.map((e) => [e.id, formatName(e)]));
    const rows = g.keys.map((k) => [k ? nameOf.get(k) ?? "Unknown" : "Unassigned", g.open(k), g.overdue(k), g.completed(k)] as [string, number, number, number]).sort((a, b) => a[0].localeCompare(b[0]));
    return { total: rows.length, notes: [`Completed: ${g.range.from} to ${g.range.to}.`], columns: [{ label: "Assignee" }, { label: "Open", type: "number" }, { label: "Overdue", type: "number" }, { label: "Completed in range", type: "number" }], rows: pageRows(ctx, rows) };
  },
};

const byProject: ReportDefinition = {
  id: "tasks-by-project", category: "tasks", title: "Tasks by project",
  description: "Open, overdue and recently completed task counts for each project.",
  filters: ["project", "client", "employee", "department", "dateRange"], access: everyone,
  definition: "Completed counts tasks completed in the date range (default: last 30 days). Standalone tasks are grouped as “No project”.",
  async run(ctx) {
    const g = await tasksGrouped(ctx, "projectId");
    const ids = g.keys.filter((k): k is string => Boolean(k));
    const projects = await prisma.project.findMany({ where: { id: { in: ids }, organizationId: ctx.user.organizationId }, select: { id: true, name: true } });
    const nameOf = new Map(projects.map((p) => [p.id, p.name]));
    const rows = g.keys.map((k) => [k ? nameOf.get(k) ?? "Unknown" : "No project", g.open(k), g.overdue(k), g.completed(k)] as [string, number, number, number]).sort((a, b) => a[0].localeCompare(b[0]));
    return { total: rows.length, notes: [`Completed: ${g.range.from} to ${g.range.to}.`], columns: [{ label: "Project" }, { label: "Open", type: "number" }, { label: "Overdue", type: "number" }, { label: "Completed in range", type: "number" }], rows: pageRows(ctx, rows) };
  },
};

const completedTasks: ReportDefinition = {
  id: "completed-tasks", category: "tasks", title: "Completed tasks",
  description: "Tasks completed within a date range (default: last 30 days).",
  filters: ["dateRange", "project", "client", "employee", "department"], access: everyone,
  definition: "“On time” compares the completion date (in your time zone) with the due date; tasks without a due date show a dash.",
  async run(ctx) {
    const range = rangeOrDefault(ctx, 30);
    const where = taskWhere(ctx, [{ status: "COMPLETED", completedAt: { gte: range.fromDate, lt: range.toExclusive } }]);
    const [rows, total] = await prisma.$transaction([
      prisma.task.findMany({ where, include: taskInclude, orderBy: [{ completedAt: "desc" }, { id: "asc" }], ...window(ctx) }),
      prisma.task.count({ where }),
    ]);
    return {
      total, notes: [`Completed ${range.from} to ${range.to}.`],
      columns: [{ label: "Task" }, { label: "Project" }, { label: "Assignee" }, { label: "Completed" }, { label: "Due" }, { label: "On time" }],
      rows: rows.map((t) => {
        const doneKey = t.completedAt ? dateKeyInZone(t.completedAt, ctx.zone) : null;
        const dueKey = t.dueDate ? dateKeyUtc(t.dueDate) : null;
        return [t.title, t.project?.name ?? null, nameCell(t.assignedTo), doneKey, dueKey, doneKey && dueKey ? (doneKey <= dueKey ? "On time" : "Late") : "—"];
      }),
    };
  },
};

export const workReports = [projectSummary, projectWorkload, openTasks, overdueTasks, byAssignee, byProject, completedTasks];
