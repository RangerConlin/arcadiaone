import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

type Actor = Pick<AuthenticatedUser, "id" | "organizationId" | "employeeId" | "role">;

export type TrainingPolicy = {
  allowSelfEnrollment: boolean;
  managersCanVerify: boolean;
  allowVerifiedQualification: boolean;
};

/** Organization-level switches, loaded from the actor's own organization. */
export async function getTrainingPolicy(organizationId: string): Promise<TrainingPolicy> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { allowTrainingSelfEnrollment: true, managersCanVerifyTraining: true, allowVerifiedQualificationFromTraining: true },
  });
  return {
    allowSelfEnrollment: org.allowTrainingSelfEnrollment,
    managersCanVerify: org.managersCanVerifyTraining,
    allowVerifiedQualification: org.allowVerifiedQualificationFromTraining,
  };
}

/**
 * Centralized training permissions.
 *  ADMIN   — everything.
 *  MANAGER — sees all employees' training (as the People/Qualifications modules do), creates and
 *            runs sessions, and verifies external records only when the organization grants it.
 *  EMPLOYEE— own history, submits own external records, and enrolls in OPEN sessions if enabled.
 */
export const isTrainingStaff = (user: Actor) => user.role === "ADMIN" || user.role === "MANAGER";
export const canManageCourses = (user: Actor) => user.role === "ADMIN";
export const canManageSessions = (user: Actor) => isTrainingStaff(user);
export const canViewEmployeeTraining = (user: Actor, employeeId: string) => isTrainingStaff(user) || user.employeeId === employeeId;
export const canSubmitRecordFor = (user: Actor, employeeId: string) => isTrainingStaff(user) || (Boolean(user.employeeId) && user.employeeId === employeeId);

/** Verification is never self-service: nobody verifies a record about themselves. */
export function canVerifyRecord(user: Actor, policy: TrainingPolicy, record: { employeeId: string }) {
  if (record.employeeId === user.employeeId) return false;
  return user.role === "ADMIN" || (user.role === "MANAGER" && policy.managersCanVerify);
}
export const canVerifyAny = (user: Actor, policy: TrainingPolicy) => user.role === "ADMIN" || (user.role === "MANAGER" && policy.managersCanVerify);

export function canSelfEnroll(user: Actor, policy: TrainingPolicy, session: { status: string }) {
  return Boolean(user.employeeId) && policy.allowSelfEnrollment && session.status === "OPEN";
}

/** Sessions an employee may see: ones they are enrolled in, plus OPEN ones. Staff see everything. */
export function sessionVisibilityWhere(user: Actor): Prisma.TrainingSessionWhereInput {
  if (isTrainingStaff(user)) return { organizationId: user.organizationId };
  return {
    organizationId: user.organizationId,
    OR: [{ status: "OPEN" }, { enrollments: { some: { employeeId: user.employeeId ?? "__none__" } } }],
  };
}

/** Records an actor may read. */
export function recordVisibilityWhere(user: Actor): Prisma.EmployeeTrainingRecordWhereInput {
  if (isTrainingStaff(user)) return { organizationId: user.organizationId };
  return { organizationId: user.organizationId, employeeId: user.employeeId ?? "__none__" };
}

export function enrollmentVisibilityWhere(user: Actor): Prisma.TrainingEnrollmentWhereInput {
  if (isTrainingStaff(user)) return { organizationId: user.organizationId };
  return { organizationId: user.organizationId, employeeId: user.employeeId ?? "__none__" };
}
