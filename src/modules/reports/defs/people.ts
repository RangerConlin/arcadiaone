import type { Prisma } from "@/generated/prisma/client";
import { addDays, keyToDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { formatName } from "@/lib/format";
import { dateCell, label, nameCell, pageRows, window } from "../helpers";
import type { ReportContext, ReportDefinition } from "../types";

const staffOnly = (user: { role: string }) => user.role === "ADMIN" || user.role === "MANAGER";
const EMPLOYMENT_STATUSES = ["ACTIVE", "INACTIVE", "LEAVE", "TERMINATED"].map((value) => ({ value, label: value.toLowerCase() }));
const QUALIFICATION_STATUSES = [
  { value: "CURRENT", label: "Current" }, { value: "EXPIRING_SOON", label: "Expiring soon" },
  { value: "EXPIRED", label: "Expired" }, { value: "NO_EXPIRATION", label: "No expiration" },
];

function employeeWhere(ctx: ReportContext, extra: Prisma.EmployeeWhereInput = {}): Prisma.EmployeeWhereInput {
  const f = ctx.filters;
  return {
    organizationId: ctx.user.organizationId,
    ...(f.department ? { departmentId: f.department } : {}),
    ...(f.position ? { positionId: f.position } : {}),
    ...(f.employee ? { id: f.employee } : {}),
    ...extra,
  };
}

const directory: ReportDefinition = {
  id: "employee-directory", category: "people", title: "Employee directory",
  description: "Employees with department, position, supervisor, status and hire date.",
  filters: ["department", "position", "status", "employee"], statusOptions: EMPLOYMENT_STATUSES,
  access: staffOnly,
  async run(ctx) {
    const where = employeeWhere(ctx, ctx.filters.status ? { employmentStatus: ctx.filters.status as never } : {});
    const [rows, total] = await prisma.$transaction([
      prisma.employee.findMany({ where, include: { department: true, position: true, supervisor: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }], ...window(ctx) }),
      prisma.employee.count({ where }),
    ]);
    return {
      total,
      columns: [{ label: "Employee" }, { label: "Employee #" }, { label: "Department" }, { label: "Position" }, { label: "Supervisor" }, { label: "Status", type: "status" }, { label: "Hire date" }],
      rows: rows.map((e) => [formatName(e), e.employeeNumber, e.department?.name ?? null, e.position?.title ?? null, nameCell(e.supervisor), label(e.employmentStatus), dateCell(e.hireDate)]),
    };
  },
};

const headcount: ReportDefinition = {
  id: "headcount", category: "people", title: "Headcount summary",
  description: "Employee counts by department, position and employment status. Counts only; no demographic data is used.",
  filters: ["department", "position"], access: staffOnly,
  definition: "Counts every employee record matching the filters, including inactive and terminated unless you filter by status in the directory.",
  async run(ctx) {
    const where = employeeWhere(ctx);
    const [byDepartment, byPosition, byStatus, departments, positions] = await Promise.all([
      prisma.employee.groupBy({ by: ["departmentId"], where, _count: { _all: true } }),
      prisma.employee.groupBy({ by: ["positionId"], where, _count: { _all: true } }),
      prisma.employee.groupBy({ by: ["employmentStatus"], where, _count: { _all: true } }),
      prisma.department.findMany({ where: { organizationId: ctx.user.organizationId }, select: { id: true, name: true } }),
      prisma.position.findMany({ where: { organizationId: ctx.user.organizationId }, select: { id: true, title: true } }),
    ]);
    const departmentName = new Map(departments.map((d) => [d.id, d.name]));
    const positionName = new Map(positions.map((p) => [p.id, p.title]));
    const rows = [
      ...byDepartment.map((g) => ["Department", g.departmentId ? departmentName.get(g.departmentId) ?? "Unknown" : "No department", g._count._all] as [string, string, number]),
      ...byPosition.map((g) => ["Position", g.positionId ? positionName.get(g.positionId) ?? "Unknown" : "No position", g._count._all] as [string, string, number]),
      ...byStatus.map((g) => ["Employment status", g.employmentStatus.toLowerCase(), g._count._all] as [string, string, number]),
    ];
    const total = byStatus.reduce((sum, g) => sum + g._count._all, 0);
    return { total: rows.length, columns: [{ label: "Grouping" }, { label: "Value" }, { label: "Employees", type: "number" }], rows: pageRows(ctx, rows), summary: [{ label: "Employees", value: String(total) }] };
  },
};

function qualificationStatusWhere(status: string | undefined, today: string, warningDays: number): Prisma.EmployeeQualificationWhereInput {
  const todayDate = keyToDate(today), limit = keyToDate(addDays(today, warningDays));
  switch (status) {
    case "EXPIRED": return { expirationDate: { lt: todayDate } };
    case "EXPIRING_SOON": return { expirationDate: { gte: todayDate, lte: limit } };
    case "CURRENT": return { expirationDate: { gt: limit } };
    case "NO_EXPIRATION": return { expirationDate: null };
    default: return {};
  }
}

function qualificationStatusLabel(expiration: Date | null, today: string, warningDays: number) {
  if (!expiration) return "no expiration";
  const key = expiration.toISOString().slice(0, 10);
  if (key < today) return "expired";
  return key <= addDays(today, warningDays) ? "expiring soon" : "current";
}

const qualificationInclude = { employee: { include: { department: true, position: true } }, qualificationType: true } satisfies Prisma.EmployeeQualificationInclude;

const qualificationStatus: ReportDefinition = {
  id: "qualification-status", category: "qualifications", title: "Qualification status",
  description: "Every active credential with verification and expiration status.",
  filters: ["department", "position", "qualificationType", "status", "employee"], statusOptions: QUALIFICATION_STATUSES, access: staffOnly,
  definition: "Status is derived from the expiration date and the organization's warning window. Credential numbers are never shown.",
  async run(ctx) {
    const f = ctx.filters;
    const where: Prisma.EmployeeQualificationWhereInput = {
      organizationId: ctx.user.organizationId, archivedAt: null,
      employee: employeeWhere(ctx, { employmentStatus: { not: "TERMINATED" } }),
      ...(f.qualificationType ? { qualificationTypeId: f.qualificationType } : {}),
      ...qualificationStatusWhere(f.status, ctx.today, ctx.warningDays),
    };
    const [rows, total] = await prisma.$transaction([
      prisma.employeeQualification.findMany({ where, include: qualificationInclude, orderBy: [{ employee: { lastName: "asc" } }, { employee: { firstName: "asc" } }, { id: "asc" }], ...window(ctx) }),
      prisma.employeeQualification.count({ where }),
    ]);
    return {
      total,
      columns: [{ label: "Employee" }, { label: "Department" }, { label: "Qualification" }, { label: "Verification", type: "status" }, { label: "Expiration" }, { label: "Status", type: "status" }],
      rows: rows.map((q) => [formatName(q.employee), q.employee.department?.name ?? null, q.qualificationType.name, label(q.verificationStatus), dateCell(q.expirationDate), qualificationStatusLabel(q.expirationDate, ctx.today, ctx.warningDays)]),
    };
  },
};

const missingRequired: ReportDefinition = {
  id: "missing-required-qualifications", category: "qualifications", title: "Missing required qualifications",
  description: "Active employees who hold no record of a qualification their position requires.",
  filters: ["department", "position", "qualificationType", "employee"], access: staffOnly,
  definition: "A requirement is missing when the employee has no non-archived record of that qualification type at all. Expired or unverified records are covered by the status report.",
  async run(ctx) {
    const requirements = await prisma.positionQualificationRequirement.findMany({
      where: { organizationId: ctx.user.organizationId, required: true, ...(ctx.filters.position ? { positionId: ctx.filters.position } : {}), ...(ctx.filters.qualificationType ? { qualificationTypeId: ctx.filters.qualificationType } : {}), qualificationType: { active: true } },
      include: { qualificationType: true, position: true },
    });
    const rows: Array<[string, string | null, string, string]> = [];
    for (const requirement of requirements) {
      const employees = await prisma.employee.findMany({
        where: employeeWhere(ctx, { positionId: requirement.positionId, employmentStatus: { in: ["ACTIVE", "LEAVE"] }, qualifications: { none: { qualificationTypeId: requirement.qualificationTypeId, archivedAt: null } } }),
        include: { department: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 2000,
      });
      for (const e of employees) rows.push([formatName(e), e.department?.name ?? null, requirement.position.title, requirement.qualificationType.name]);
    }
    rows.sort((a, b) => a[0].localeCompare(b[0]) || a[3].localeCompare(b[3]));
    return { total: rows.length, columns: [{ label: "Employee" }, { label: "Department" }, { label: "Position" }, { label: "Missing qualification" }], rows: pageRows(ctx, rows) };
  },
};

const expiring: ReportDefinition = {
  id: "expiring-qualifications", category: "qualifications", title: "Expiring qualifications",
  description: "Credentials that expire within a chosen number of days (default: the organization's warning window).",
  filters: ["days", "department", "position", "qualificationType", "employee"], access: staffOnly,
  async run(ctx) {
    const days = ctx.filters.days ?? ctx.warningDays;
    const where: Prisma.EmployeeQualificationWhereInput = {
      organizationId: ctx.user.organizationId, archivedAt: null, employee: employeeWhere(ctx, { employmentStatus: { not: "TERMINATED" } }),
      ...(ctx.filters.qualificationType ? { qualificationTypeId: ctx.filters.qualificationType } : {}),
      expirationDate: { gte: keyToDate(ctx.today), lte: keyToDate(addDays(ctx.today, days)) },
    };
    const [rows, total] = await prisma.$transaction([
      prisma.employeeQualification.findMany({ where, include: qualificationInclude, orderBy: [{ expirationDate: "asc" }, { id: "asc" }], ...window(ctx) }),
      prisma.employeeQualification.count({ where }),
    ]);
    return {
      total, notes: [`Showing credentials expiring from ${ctx.today} through ${addDays(ctx.today, days)} (${days} days).`],
      columns: [{ label: "Employee" }, { label: "Department" }, { label: "Qualification" }, { label: "Expires" }, { label: "Days left", type: "number" }, { label: "Verification", type: "status" }],
      rows: rows.map((q) => [formatName(q.employee), q.employee.department?.name ?? null, q.qualificationType.name, dateCell(q.expirationDate), Math.round((q.expirationDate!.getTime() - keyToDate(ctx.today).getTime()) / 86_400_000), label(q.verificationStatus)]),
    };
  },
};

export const peopleReports = [directory, headcount, qualificationStatus, missingRequired, expiring];
