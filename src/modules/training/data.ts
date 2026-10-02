import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { enrollmentVisibilityWhere, recordVisibilityWhere, sessionVisibilityWhere } from "./authorization";

export const TRAINING_PAGE_SIZE = 25;

export const sessionInclude = {
  trainingCourse: { select: { id: true, name: true, code: true, provider: true } },
  _count: { select: { enrollments: { where: { status: { not: "CANCELLED" } } } } },
} satisfies Prisma.TrainingSessionInclude;

export const sessionTitle = (session: { titleOverride: string | null; trainingCourse: { name: string } }) => session.titleOverride ?? session.trainingCourse.name;

export async function listSessions(user: AuthenticatedUser, which: "upcoming" | "recent", now = new Date()) {
  const where: Prisma.TrainingSessionWhereInput = which === "upcoming"
    ? { AND: [sessionVisibilityWhere(user), { status: { in: ["PLANNED", "OPEN"] }, OR: [{ startAt: { gte: now } }, { endAt: { gte: now } }] }] }
    : { AND: [sessionVisibilityWhere(user), { OR: [{ status: { in: ["COMPLETED", "CANCELLED"] } }, { startAt: { lt: now }, endAt: { lt: now } }] }, { startAt: { gte: new Date(now.getTime() - 120 * 86_400_000) } }] };
  return prisma.trainingSession.findMany({ where, include: sessionInclude, orderBy: { startAt: which === "upcoming" ? "asc" : "desc" }, take: 100 });
}

export async function listCourses(user: AuthenticatedUser, includeInactive = false) {
  return prisma.trainingCourse.findMany({
    where: { organizationId: user.organizationId, ...(includeInactive ? {} : { active: true }) },
    include: { qualificationLinks: { include: { qualificationType: { select: { id: true, name: true } } } }, _count: { select: { sessions: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

export type RecordFilter = "unverified" | "verified" | "rejected" | "all";
export async function listRecords(user: AuthenticatedUser, filter: RecordFilter, page: number) {
  const status: Prisma.EmployeeTrainingRecordWhereInput =
    filter === "unverified" ? { verified: false, rejectedAt: null } : filter === "verified" ? { verified: true } : filter === "rejected" ? { rejectedAt: { not: null }, verified: false } : {};
  const where: Prisma.EmployeeTrainingRecordWhereInput = { AND: [recordVisibilityWhere(user), status] };
  const safePage = Math.max(1, page);
  const [rows, total] = await prisma.$transaction([
    prisma.employeeTrainingRecord.findMany({
      where, include: { employee: { select: { id: true, firstName: true, preferredName: true, lastName: true, suffix: true } }, trainingCourse: { select: { name: true } } },
      orderBy: [{ completionDate: "desc" }, { id: "asc" }], skip: (safePage - 1) * TRAINING_PAGE_SIZE, take: TRAINING_PAGE_SIZE,
    }),
    prisma.employeeTrainingRecord.count({ where }),
  ]);
  return { rows, total, page: safePage, pages: Math.max(1, Math.ceil(total / TRAINING_PAGE_SIZE)) };
}

/** Everything an employee has done: completed session enrollments plus external records, newest first. */
export async function employeeHistory(user: AuthenticatedUser, employeeId: string) {
  const [enrollments, records] = await Promise.all([
    prisma.trainingEnrollment.findMany({
      where: { AND: [enrollmentVisibilityWhere(user), { employeeId, status: "COMPLETED" }] },
      include: { trainingSession: { include: { trainingCourse: true } }, employeeQualification: { include: { qualificationType: { select: { name: true } } } } },
      orderBy: { completionDate: "desc" },
    }),
    prisma.employeeTrainingRecord.findMany({
      where: { AND: [recordVisibilityWhere(user), { employeeId }] },
      include: { employeeQualification: { include: { qualificationType: { select: { name: true } } } }, trainingCourse: { select: { name: true } }, documentRelations: { select: { documentId: true } } },
      orderBy: { completionDate: "desc" },
    }),
  ]);
  const sessionDocs = await prisma.documentRelation.findMany({ where: { organizationId: user.organizationId, trainingSessionId: { in: enrollments.map((e) => e.trainingSessionId) } }, select: { trainingSessionId: true } });
  const docCount = new Map<string, number>();
  for (const d of sessionDocs) docCount.set(d.trainingSessionId!, (docCount.get(d.trainingSessionId!) ?? 0) + 1);
  const items = [
    ...enrollments.map((e) => ({
      key: `e:${e.id}`, kind: "Session" as const, href: `/training/sessions/${e.trainingSessionId}`,
      course: e.trainingSession.titleOverride ?? e.trainingSession.trainingCourse.name, provider: e.trainingSession.providerOverride ?? e.trainingSession.trainingCourse.provider,
      completionDate: e.completionDate!, hours: e.hoursCompleted, verification: "Recorded by staff", qualification: e.employeeQualification?.qualificationType.name ?? null,
      documents: docCount.get(e.trainingSessionId) ?? 0,
    })),
    ...records.map((r) => ({
      key: `r:${r.id}`, kind: "External" as const, href: `/training/records/${r.id}`, course: r.courseName, provider: r.provider, completionDate: r.completionDate, hours: r.hours,
      verification: r.verified ? "Verified" : r.rejectedAt ? "Rejected" : "Awaiting verification", qualification: r.employeeQualification?.qualificationType.name ?? null, documents: r.documentRelations.length,
    })),
  ].sort((a, b) => b.completionDate.getTime() - a.completionDate.getTime());
  return items;
}
