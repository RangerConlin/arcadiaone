import type { Prisma } from "@/generated/prisma/client";
import { Prisma as P } from "@/generated/prisma/client";
import { dateKeyUtc, diffDays, keyToDate } from "@/lib/datetime";
import { formatName } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { enrollmentVisibilityWhere, recordVisibilityWhere, sessionVisibilityWhere } from "@/modules/training/authorization";
import { dateCell, instantCell, label, pageRows, rangeOrDefault } from "../helpers";
import type { Cell, ReportContext, ReportDefinition } from "../types";

const everyone = () => true;
const staffOnly = (user: { role: string }) => user.role === "ADMIN" || user.role === "MANAGER";
const ROW_CAP = 5000;

type Line = { employeeId: string; employee: string; department: string | null; course: string; courseId: string | null; provider: string | null; completed: Date; hours: P.Decimal | null; source: "Session" | "External"; verification: string };

/**
 * One normalized list of completed training: staff-recorded session completions plus external records.
 * Both inherit the viewer's visibility (employees see only themselves), and the same filters apply.
 */
async function completedLines(ctx: ReportContext, window: { from?: string; to?: string }): Promise<Line[]> {
  const f = ctx.filters;
  const dates = (window.from || window.to) ? { ...(window.from ? { gte: keyToDate(window.from) } : {}), ...(window.to ? { lte: keyToDate(window.to) } : {}) } : undefined;
  const employeeWhere: Prisma.EmployeeWhereInput = { ...(f.department ? { departmentId: f.department } : {}), ...(f.employee ? { id: f.employee } : {}) };
  const [enrollments, records] = await Promise.all([
    prisma.trainingEnrollment.findMany({
      where: { AND: [enrollmentVisibilityWhere(ctx.user), { status: "COMPLETED", ...(dates ? { completionDate: dates } : {}), employee: employeeWhere, ...(f.course ? { trainingSession: { trainingCourseId: f.course } } : {}) }] },
      include: { employee: { include: { department: true } }, trainingSession: { include: { trainingCourse: true } } }, orderBy: { completionDate: "desc" }, take: ROW_CAP,
    }),
    prisma.employeeTrainingRecord.findMany({
      where: { AND: [recordVisibilityWhere(ctx.user), { ...(dates ? { completionDate: dates } : {}), employee: employeeWhere, ...(f.course ? { trainingCourseId: f.course } : {}) }] },
      include: { employee: { include: { department: true } } }, orderBy: { completionDate: "desc" }, take: ROW_CAP,
    }),
  ]);
  return [
    ...enrollments.map((e): Line => ({
      employeeId: e.employeeId, employee: formatName(e.employee), department: e.employee.department?.name ?? null, course: e.trainingSession.titleOverride ?? e.trainingSession.trainingCourse.name,
      courseId: e.trainingSession.trainingCourseId, provider: e.trainingSession.providerOverride ?? e.trainingSession.trainingCourse.provider, completed: e.completionDate!, hours: e.hoursCompleted, source: "Session", verification: "Recorded by staff",
    })),
    ...records.map((r): Line => ({
      employeeId: r.employeeId, employee: formatName(r.employee), department: r.employee.department?.name ?? null, course: r.courseName, courseId: r.trainingCourseId, provider: r.provider,
      completed: r.completionDate, hours: r.hours, source: "External", verification: r.verified ? "Verified" : r.rejectedAt ? "Rejected" : "Awaiting verification",
    })),
  ].sort((a, b) => b.completed.getTime() - a.completed.getTime() || a.employee.localeCompare(b.employee));
}

const lineColumns = [{ label: "Employee" }, { label: "Department" }, { label: "Course" }, { label: "Provider" }, { label: "Completed" }, { label: "Hours", type: "number" as const }, { label: "Source" }, { label: "Verification" }];
const lineRow = (l: Line): Cell[] => [l.employee, l.department, l.course, l.provider, dateCell(l.completed), l.hours ? l.hours.toFixed(2) : null, l.source, l.verification];
const sumHours = (lines: Line[], include: (l: Line) => boolean = () => true) => lines.filter(include).reduce((sum, l) => sum.plus(l.hours ?? 0), new P.Decimal(0));
/** Hours that count toward "verified" totals: staff-recorded sessions and verified external records. */
const counts = (l: Line) => l.verification === "Recorded by staff" || l.verification === "Verified";

const history: ReportDefinition = {
  id: "training-history", category: "training", title: "Training history",
  description: "Completed training for each employee: sessions recorded by staff and external records, with hours and verification.",
  filters: ["employee", "department", "course", "dateRange"], access: everyone,
  definition: "Hours are the actual hours recorded per person, not the scheduled length. External records awaiting verification or rejected are listed but flagged. Employees see only their own history.",
  async run(ctx) {
    const lines = await completedLines(ctx, { from: ctx.filters.from, to: ctx.filters.to });
    return { total: lines.length, columns: lineColumns, rows: pageRows(ctx, lines.map(lineRow)), summary: [{ label: "Completions", value: String(lines.length) }, { label: "Hours (all)", value: sumHours(lines).toFixed(2) }, { label: "Hours (verified or staff-recorded)", value: sumHours(lines, counts).toFixed(2) }] };
  },
};

const completed: ReportDefinition = {
  id: "training-completed", category: "training", title: "Training completed in a date range",
  description: "Everything completed between two dates (default: last 30 days).",
  filters: ["dateRange", "department", "employee", "course"], access: everyone,
  async run(ctx) {
    const range = rangeOrDefault(ctx, 30);
    const lines = await completedLines(ctx, { from: range.from, to: range.to });
    return { total: lines.length, notes: [`Completed ${range.from} to ${range.to}.`], columns: lineColumns, rows: pageRows(ctx, lines.map(lineRow)), summary: [{ label: "Completions", value: String(lines.length) }, { label: "Hours (all)", value: sumHours(lines).toFixed(2) }] };
  },
};

function groupHours(lines: Line[], key: (l: Line) => string) {
  const groups = new Map<string, { count: number; all: P.Decimal; counted: P.Decimal; pending: P.Decimal }>();
  for (const l of lines) {
    const k = key(l);
    const g = groups.get(k) ?? { count: 0, all: new P.Decimal(0), counted: new P.Decimal(0), pending: new P.Decimal(0) };
    const h = new P.Decimal(l.hours ?? 0);
    g.count += 1; g.all = g.all.plus(h);
    if (counts(l)) g.counted = g.counted.plus(h); else if (l.verification === "Awaiting verification") g.pending = g.pending.plus(h);
    groups.set(k, g);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
const hourColumns = (first: string) => [{ label: first }, { label: "Completions", type: "number" as const }, { label: "Verified / staff-recorded hours", type: "number" as const }, { label: "Awaiting verification (hours)", type: "number" as const }, { label: "Total hours", type: "number" as const }];

const hoursByEmployee: ReportDefinition = {
  id: "training-hours-by-employee", category: "training", title: "Training hours by employee",
  description: "Hours completed per employee in a date range (default: this year to date).",
  filters: ["dateRange", "department", "employee", "course"], access: everyone,
  definition: "Hours are those actually recorded. Verified / staff-recorded hours count session completions recorded by staff and verified external records; hours on unverified external records are shown separately and rejected ones are excluded from the total. Generic hours only; no profession-specific continuing-education rules are applied.",
  async run(ctx) {
    const from = ctx.filters.from ?? `${ctx.today.slice(0, 4)}-01-01`;
    const lines = (await completedLines(ctx, { from, to: ctx.filters.to ?? ctx.today })).filter((l) => l.verification !== "Rejected");
    const rows = groupHours(lines, (l) => `${l.employee}|${l.department ?? ""}`).map(([k, g]) => [k.split("|")[0], g.count, g.counted.toFixed(2), g.pending.toFixed(2), g.all.toFixed(2)] as Cell[]);
    return { total: rows.length, notes: [`Completed ${from} to ${ctx.filters.to ?? ctx.today}.`], columns: hourColumns("Employee"), rows: pageRows(ctx, rows), summary: [{ label: "Total hours", value: sumHours(lines).toFixed(2) }] };
  },
};

const hoursByCourse: ReportDefinition = {
  id: "training-hours-by-course", category: "training", title: "Training hours by course",
  description: "Hours and completions per course in a date range (default: this year to date).",
  filters: ["dateRange", "department", "employee", "course"], access: everyone,
  definition: "External records not matched to a defined course are grouped under their own course name.",
  async run(ctx) {
    const from = ctx.filters.from ?? `${ctx.today.slice(0, 4)}-01-01`;
    const lines = (await completedLines(ctx, { from, to: ctx.filters.to ?? ctx.today })).filter((l) => l.verification !== "Rejected");
    const rows = groupHours(lines, (l) => l.course).map(([k, g]) => [k, g.count, g.counted.toFixed(2), g.pending.toFixed(2), g.all.toFixed(2)] as Cell[]);
    return { total: rows.length, notes: [`Completed ${from} to ${ctx.filters.to ?? ctx.today}.`], columns: hourColumns("Course"), rows: pageRows(ctx, rows), summary: [{ label: "Total hours", value: sumHours(lines).toFixed(2) }] };
  },
};

const upcoming: ReportDefinition = {
  id: "upcoming-training-sessions", category: "training", title: "Upcoming training sessions",
  description: "Sessions that have not started yet, with enrollment against capacity.",
  filters: ["course", "dateRange"], access: everyone,
  async run(ctx) {
    const where: Prisma.TrainingSessionWhereInput = {
      AND: [sessionVisibilityWhere(ctx.user), { status: { in: ["PLANNED", "OPEN"] }, startAt: { gte: ctx.now } }, ...(ctx.filters.course ? [{ trainingCourseId: ctx.filters.course }] : []),
        ...(ctx.filters.from ? [{ startAt: { gte: keyToDate(ctx.filters.from) } }] : []), ...(ctx.filters.to ? [{ startAt: { lt: keyToDate(`${ctx.filters.to}`) } }] : [])],
    };
    const sessions = await prisma.trainingSession.findMany({ where, include: { trainingCourse: { select: { name: true } }, _count: { select: { enrollments: { where: { status: { not: "CANCELLED" } } } } } }, orderBy: { startAt: "asc" }, take: ROW_CAP });
    const rows = sessions.map((s): Cell[] => [instantCell(s.startAt, ctx.zone), s.titleOverride ?? s.trainingCourse.name, s.location, s.instructor, s._count.enrollments, s.maxParticipants, label(s.status)]);
    return { total: rows.length, columns: [{ label: "Starts" }, { label: "Session" }, { label: "Location" }, { label: "Instructor" }, { label: "Enrolled", type: "number" }, { label: "Capacity", type: "number" }, { label: "Status", type: "status" }], rows: pageRows(ctx, rows) };
  },
};

const unverified: ReportDefinition = {
  id: "unverified-training", category: "training", title: "Unverified training submissions",
  description: "External training records waiting for review, oldest first.",
  filters: ["department", "employee", "course"], access: staffOnly,
  async run(ctx) {
    const f = ctx.filters;
    const records = await prisma.employeeTrainingRecord.findMany({
      where: { AND: [recordVisibilityWhere(ctx.user), { verified: false, rejectedAt: null, employee: { ...(f.department ? { departmentId: f.department } : {}), ...(f.employee ? { id: f.employee } : {}) }, ...(f.course ? { trainingCourseId: f.course } : {}) }] },
      include: { employee: { include: { department: true } } }, orderBy: { createdAt: "asc" }, take: ROW_CAP,
    });
    const rows = records.map((r): Cell[] => [formatName(r.employee), r.employee.department?.name ?? null, r.courseName, r.provider, dateCell(r.completionDate), r.hours ? r.hours.toFixed(2) : null, dateCell(r.createdAt), diffDays(dateKeyUtc(r.createdAt), ctx.today)]);
    return { total: rows.length, notes: ["Verification is by an administrator (or a manager if the organization allows it). Nobody verifies their own record."], columns: [{ label: "Employee" }, { label: "Department" }, { label: "Course" }, { label: "Provider" }, { label: "Completed" }, { label: "Hours", type: "number" }, { label: "Submitted" }, { label: "Days waiting", type: "number" }], rows: pageRows(ctx, rows) };
  },
};

export const trainingReports = [history, completed, hoursByEmployee, hoursByCourse, upcoming, unverified];
