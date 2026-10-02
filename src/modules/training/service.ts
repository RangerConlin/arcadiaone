import type { Prisma } from "@/generated/prisma/client";
import { dateKeyUtc, keyToDate } from "@/lib/datetime";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { audit, userActor } from "@/modules/audit/service";
import { applyQualificationEffects, type QualificationOutcome } from "./qualification-link";
import { canSelfEnroll, canVerifyRecord, isTrainingStaff, type TrainingPolicy } from "./authorization";
import type { AuthenticatedUser } from "@/lib/auth/session";

type Tx = Prisma.TransactionClient;
type Actor = Pick<AuthenticatedUser, "id" | "email" | "organizationId" | "employeeId" | "role">;

export class TrainingError extends Error {}

/** Enrolls an employee (or re-activates a cancelled enrollment). Enforces status, capacity and permission. */
export async function enrollEmployee(tx: Tx, user: Actor, policy: TrainingPolicy, sessionId: string, employeeId: string) {
  const session = await tx.trainingSession.findFirst({ where: { id: sessionId, organizationId: user.organizationId }, include: { trainingCourse: { select: { name: true } } } });
  if (!session) throw new TrainingError("Session not found.");
  if (session.status === "COMPLETED" || session.status === "CANCELLED") throw new TrainingError("This session is closed to enrollment.");
  const self = employeeId === user.employeeId;
  if (!isTrainingStaff(user) && !(self && canSelfEnroll(user, policy, session))) throw new TrainingError("You cannot enroll in this session.");
  const employee = await tx.employee.findFirst({ where: { id: employeeId, organizationId: user.organizationId, employmentStatus: { in: ["ACTIVE", "LEAVE"] } }, select: { id: true } });
  if (!employee) throw new TrainingError("That employee is not available for enrollment.");
  const existing = await tx.trainingEnrollment.findUnique({ where: { trainingSessionId_employeeId: { trainingSessionId: sessionId, employeeId } } });
  if (existing && existing.status !== "CANCELLED") throw new TrainingError("Already enrolled.");
  if (session.maxParticipants !== null) {
    const taken = await tx.trainingEnrollment.count({ where: { trainingSessionId: sessionId, status: { not: "CANCELLED" } } });
    if (taken >= session.maxParticipants) throw new TrainingError("This session is full.");
  }
  const enrollment = existing
    ? await tx.trainingEnrollment.update({ where: { id: existing.id }, data: { status: "ENROLLED", completionDate: null, hoursCompleted: null, score: null, passed: null } })
    : await tx.trainingEnrollment.create({ data: { organizationId: user.organizationId, trainingSessionId: sessionId, employeeId, enrolledByUserId: user.id } });
  return { enrollment, session };
}

export type OutcomeInput = {
  status: "ENROLLED" | "ATTENDED" | "COMPLETED" | "NO_SHOW" | "CANCELLED";
  completionDate: string; hoursCompleted: Prisma.Decimal | null; score: Prisma.Decimal | null; passed: boolean | null; notes: string | null;
};

/**
 * Records attendance or completion. Hours are whatever the person actually completed; the scheduled
 * duration is never assumed. Completion applies the course's configured qualification effects.
 */
export async function recordOutcome(tx: Tx, user: Actor, policy: TrainingPolicy, enrollmentId: string, input: OutcomeInput, today: string) {
  const enrollment = await tx.trainingEnrollment.findFirst({
    where: { id: enrollmentId, organizationId: user.organizationId },
    include: { trainingSession: { include: { trainingCourse: true } }, employee: { select: { firstName: true, lastName: true } } },
  });
  if (!enrollment) throw new TrainingError("Enrollment not found.");
  const session = enrollment.trainingSession;
  if (session.status === "CANCELLED") throw new TrainingError("This session was cancelled.");
  const completionKey = input.completionDate || dateKeyUtc(session.startAt);
  if (input.status === "COMPLETED" && completionKey > today) throw new TrainingError("The completion date cannot be in the future.");
  const completing = input.status === "COMPLETED";
  const updated = await tx.trainingEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: input.status, notes: input.notes, score: input.score, passed: input.passed,
      completionDate: completing ? keyToDate(completionKey) : null,
      hoursCompleted: completing || input.status === "ATTENDED" ? input.hoursCompleted : null,
    },
  });
  let outcome: QualificationOutcome | null = null;
  if (completing && enrollment.status !== "COMPLETED") {
    outcome = await applyQualificationEffects(tx, {
      organizationId: user.organizationId, employeeId: enrollment.employeeId, trainingCourseId: session.trainingCourseId, completionDate: keyToDate(completionKey),
      policy, actor: userActor(user), actorUserId: user.id, courseName: session.titleOverride ?? session.trainingCourse.name,
    });
    if (outcome.qualificationId && !enrollment.employeeQualificationId) {
      await tx.trainingEnrollment.update({ where: { id: enrollmentId }, data: { employeeQualificationId: outcome.qualificationId } });
    }
    await audit.record(tx, {
      organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.trainingEnrollmentCompleted, entityType: "TrainingSession", entityId: session.id,
      summary: `${enrollment.employee.firstName} ${enrollment.employee.lastName} completed ${session.titleOverride ?? session.trainingCourse.name}`,
      metadata: { employeeId: enrollment.employeeId, hours: updated.hoursCompleted, passed: updated.passed, qualificationsCreated: outcome.created.length, suggestions: outcome.suggested.length },
    });
  }
  return { enrollment: updated, outcome };
}

/** Closes a session. Anyone still merely ENROLLED must be resolved first, or explicitly marked no-show. */
export async function completeSession(tx: Tx, user: Actor, sessionId: string, markRemainingNoShow: boolean) {
  const session = await tx.trainingSession.findFirst({ where: { id: sessionId, organizationId: user.organizationId }, include: { trainingCourse: { select: { name: true } } } });
  if (!session) throw new TrainingError("Session not found.");
  if (session.status === "COMPLETED") throw new TrainingError("This session is already completed.");
  if (session.status === "CANCELLED") throw new TrainingError("A cancelled session cannot be completed.");
  const unresolved = await tx.trainingEnrollment.count({ where: { trainingSessionId: sessionId, status: "ENROLLED" } });
  if (unresolved && !markRemainingNoShow) throw new TrainingError(`${unresolved} participant${unresolved === 1 ? " is" : "s are"} still only enrolled. Record attendance first, or choose to mark them as no-shows.`);
  if (unresolved) await tx.trainingEnrollment.updateMany({ where: { trainingSessionId: sessionId, status: "ENROLLED" }, data: { status: "NO_SHOW" } });
  await tx.trainingSession.update({ where: { id: sessionId }, data: { status: "COMPLETED", completedAt: new Date() } });
  const completed = await tx.trainingEnrollment.count({ where: { trainingSessionId: sessionId, status: "COMPLETED" } });
  await audit.record(tx, {
    organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.trainingSessionCompleted, entityType: "TrainingSession", entityId: sessionId,
    summary: `Session “${session.titleOverride ?? session.trainingCourse.name}” completed (${completed} completed, ${unresolved} marked no-show)`, metadata: { completed, noShows: unresolved },
  });
  return session;
}

export async function cancelSession(tx: Tx, user: Actor, sessionId: string, reason: string | null) {
  const session = await tx.trainingSession.findFirst({ where: { id: sessionId, organizationId: user.organizationId }, include: { trainingCourse: { select: { name: true } } } });
  if (!session) throw new TrainingError("Session not found.");
  if (session.status === "COMPLETED") throw new TrainingError("A completed session cannot be cancelled.");
  if (session.status === "CANCELLED") throw new TrainingError("This session is already cancelled.");
  await tx.trainingSession.update({ where: { id: sessionId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await tx.trainingEnrollment.updateMany({ where: { trainingSessionId: sessionId, status: "ENROLLED" }, data: { status: "CANCELLED" } });
  await audit.record(tx, {
    organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.trainingSessionCancelled, entityType: "TrainingSession", entityId: sessionId,
    summary: `Session “${session.titleOverride ?? session.trainingCourse.name}” cancelled`, metadata: { reason },
  });
  return session;
}

/** New external records always start unverified, whoever enters them. */
export async function submitRecord(tx: Tx, user: Actor, input: { employeeId: string; trainingCourseId: string | null; courseName: string; provider: string; completionDate: string; hours: Prisma.Decimal | null; certificateNumber: string | null; notes: string | null }, today: string) {
  if (input.completionDate > today) throw new TrainingError("The completion date cannot be in the future.");
  if (!isTrainingStaff(user) && input.employeeId !== user.employeeId) throw new TrainingError("You can only submit training for yourself.");
  const employee = await tx.employee.findFirst({ where: { id: input.employeeId, organizationId: user.organizationId }, select: { id: true, firstName: true, lastName: true } });
  if (!employee) throw new TrainingError("Employee not found.");
  if (input.trainingCourseId && !await tx.trainingCourse.findFirst({ where: { id: input.trainingCourseId, organizationId: user.organizationId }, select: { id: true } })) throw new TrainingError("Course not found.");
  const record = await tx.employeeTrainingRecord.create({
    data: {
      organizationId: user.organizationId, employeeId: input.employeeId, trainingCourseId: input.trainingCourseId, courseName: input.courseName, provider: input.provider,
      completionDate: keyToDate(input.completionDate), hours: input.hours, certificateNumber: input.certificateNumber, notes: input.notes, submittedByUserId: user.id,
    },
  });
  await audit.record(tx, {
    organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.trainingRecordSubmitted, entityType: "EmployeeTrainingRecord", entityId: record.id,
    summary: `Training “${record.courseName}” submitted for ${employee.firstName} ${employee.lastName}`, metadata: { employeeId: input.employeeId, hours: record.hours, completionDate: input.completionDate },
  });
  return record;
}

export async function verifyRecord(tx: Tx, user: Actor, policy: TrainingPolicy, recordId: string) {
  const record = await tx.employeeTrainingRecord.findFirst({ where: { id: recordId, organizationId: user.organizationId } });
  if (!record) throw new TrainingError("Record not found.");
  if (!canVerifyRecord(user, policy, record)) throw new TrainingError(record.employeeId === user.employeeId ? "You cannot verify your own training." : "You are not allowed to verify training records.");
  if (record.verified) throw new TrainingError("This record is already verified.");
  const claimed = await tx.employeeTrainingRecord.updateMany({ where: { id: recordId, verified: false }, data: { verified: true, verifiedAt: new Date(), verifiedByUserId: user.id, rejectedAt: null, rejectedByUserId: null, rejectionReason: null } });
  if (!claimed.count) throw new TrainingError("This record is already verified.");
  const outcome = await applyQualificationEffects(tx, {
    organizationId: user.organizationId, employeeId: record.employeeId, trainingCourseId: record.trainingCourseId, completionDate: record.completionDate,
    policy, actor: userActor(user), actorUserId: user.id, courseName: record.courseName,
  });
  if (outcome.qualificationId && !record.employeeQualificationId) await tx.employeeTrainingRecord.update({ where: { id: recordId }, data: { employeeQualificationId: outcome.qualificationId } });
  await audit.record(tx, {
    organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.trainingRecordVerified, entityType: "EmployeeTrainingRecord", entityId: recordId,
    summary: `Training “${record.courseName}” verified`, metadata: { employeeId: record.employeeId, qualificationsCreated: outcome.created.length, suggestions: outcome.suggested.length },
  });
  return { record, outcome };
}

export async function rejectRecord(tx: Tx, user: Actor, policy: TrainingPolicy, recordId: string, reason: string) {
  const record = await tx.employeeTrainingRecord.findFirst({ where: { id: recordId, organizationId: user.organizationId } });
  if (!record) throw new TrainingError("Record not found.");
  if (!canVerifyRecord(user, policy, record)) throw new TrainingError("You are not allowed to review training records.");
  if (record.verified) throw new TrainingError("A verified record cannot be rejected.");
  await tx.employeeTrainingRecord.update({ where: { id: recordId }, data: { rejectedAt: new Date(), rejectedByUserId: user.id, rejectionReason: reason } });
  await audit.record(tx, {
    organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.trainingRecordRejected, entityType: "EmployeeTrainingRecord", entityId: recordId,
    summary: `Training “${record.courseName}” rejected`, metadata: { employeeId: record.employeeId, reason },
  });
  return record;
}

/** Staff-initiated creation of a suggested qualification (always unverified). */
export async function createSuggestedQualification(tx: Tx, user: Actor, policy: TrainingPolicy, source: { kind: "enrollment" | "record"; id: string }, qualificationTypeId: string) {
  const row = source.kind === "enrollment"
    ? await tx.trainingEnrollment.findFirst({ where: { id: source.id, organizationId: user.organizationId, status: "COMPLETED" }, include: { trainingSession: { include: { trainingCourse: true } } } })
    : await tx.employeeTrainingRecord.findFirst({ where: { id: source.id, organizationId: user.organizationId, verified: true }, include: { trainingCourse: true } });
  if (!row) throw new TrainingError("Only completed training (or verified records) can lead to a qualification.");
  const courseId = "trainingSession" in row ? row.trainingSession.trainingCourseId : row.trainingCourseId;
  const completionDate = "trainingSession" in row ? row.completionDate! : row.completionDate;
  const link = courseId ? await tx.trainingCourseQualification.findFirst({ where: { trainingCourseId: courseId, qualificationTypeId, organizationId: user.organizationId } }) : null;
  if (!link) throw new TrainingError("That qualification is not linked to this course.");
  const type = await tx.qualificationType.findFirstOrThrow({ where: { id: qualificationTypeId, organizationId: user.organizationId, active: true } });
  const existing = await tx.employeeQualification.findFirst({ where: { organizationId: user.organizationId, employeeId: row.employeeId, qualificationTypeId, archivedAt: null, issueDate: completionDate } });
  if (existing) throw new TrainingError("A matching qualification already exists.");
  const qualification = await tx.employeeQualification.create({ data: { organizationId: user.organizationId, employeeId: row.employeeId, qualificationTypeId, issueDate: completionDate, issuingOrganization: type.issuingOrganization, verificationStatus: "UNVERIFIED", verificationNote: "Created from completed training; needs verification." } });
  if (source.kind === "enrollment") await tx.trainingEnrollment.update({ where: { id: source.id }, data: { employeeQualificationId: row.employeeQualificationId ?? qualification.id } });
  else await tx.employeeTrainingRecord.update({ where: { id: source.id }, data: { employeeQualificationId: row.employeeQualificationId ?? qualification.id } });
  await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.qualificationAdded, entityType: "EmployeeQualification", entityId: qualification.id, summary: `${type.name} proposed (unverified) from training`, metadata: { employeeId: row.employeeId, source: "training-suggestion" } });
  void policy;
  return qualification;
}
