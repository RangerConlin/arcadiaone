"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthenticatedUser, requireRole, type AuthenticatedUser } from "@/lib/auth/session";
import { todayKey, zonedWallTimeToUtc } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { diffChanges } from "@/modules/audit/sanitize";
import { audit, userActor } from "@/modules/audit/service";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { createDocument } from "@/modules/documents/service";
import { notifyTrainingEnrolled, notifyTrainingSessionChanged, notifyTrainingVerificationNeeded } from "@/modules/notifications/events";
import { canManageCourses, canManageSessions, canSubmitRecordFor, canVerifyAny, getTrainingPolicy, isTrainingStaff } from "./authorization";
import * as svc from "./service";
import { courseSchema, outcomeSchema, recordSchema, sessionSchema } from "./validation";

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const fail = (path: string, message: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
const done = (path: string, message: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}success=${encodeURIComponent(message)}`);

async function run<T>(path: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof svc.TrainingError) return fail(path, error.message);
    if ((error as { code?: string })?.code === "P2002") return fail(path, "That already exists.");
    throw error;
  }
}

// ------------------------------------------------------------------ courses (administrators)

const COURSE_AUDIT = ["name", "code", "provider", "defaultDurationHours", "deliveryMethod", "active"] as const;

export async function saveCourse(form: FormData) {
  const user = await requireRole("ADMIN");
  if (!canManageCourses(user)) redirect("/forbidden");
  const id = text(form, "id");
  const path = "/administration/training-courses";
  const parsed = courseSchema.safeParse({
    name: text(form, "name"), code: text(form, "code"), description: text(form, "description"), provider: text(form, "provider"),
    defaultDurationHours: text(form, "defaultDurationHours"), deliveryMethod: text(form, "deliveryMethod"),
  });
  if (!parsed.success) return fail(path, parsed.error.issues[0]?.message ?? "Invalid course.");
  const active = id ? form.get("active") === "true" : true;
  await run(path, () => prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.trainingCourse.findFirst({ where: { id, organizationId: user.organizationId } });
      if (!before) throw new svc.TrainingError("Course not found.");
      const after = await tx.trainingCourse.update({ where: { id }, data: { ...parsed.data, active } });
      const changes = diffChanges(before, after, COURSE_AUDIT);
      if (changes.length) await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.trainingCourseUpdated, entityType: "TrainingCourse", entityId: id, summary: `Course “${after.name}” updated`, changes });
    } else {
      const created = await tx.trainingCourse.create({ data: { ...parsed.data, organizationId: user.organizationId } });
      await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.trainingCourseCreated, entityType: "TrainingCourse", entityId: created.id, summary: `Course “${created.name}” created` });
    }
  }));
  return done(path, "Course saved.");
}

export async function saveCourseQualification(form: FormData) {
  const user = await requireRole("ADMIN");
  const path = "/administration/training-courses";
  const courseId = text(form, "trainingCourseId"), typeId = text(form, "qualificationTypeId");
  const effect = z.enum(["NONE", "SUGGEST", "CREATE_UNVERIFIED", "CREATE_VERIFIED"]).safeParse(text(form, "effect"));
  if (!effect.success) return fail(path, "Choose what completing the course should do.");
  const policy = await getTrainingPolicy(user.organizationId);
  if (effect.data === "CREATE_VERIFIED" && !policy.allowVerifiedQualification) return fail(path, "Granting verified qualifications from training is disabled in the organization policy. Enable it under Training and maintenance settings first.");
  await run(path, () => prisma.$transaction(async (tx) => {
    const [course, type] = await Promise.all([
      tx.trainingCourse.findFirst({ where: { id: courseId, organizationId: user.organizationId } }),
      tx.qualificationType.findFirst({ where: { id: typeId, organizationId: user.organizationId } }),
    ]);
    if (!course || !type) throw new svc.TrainingError("Course or qualification type not found.");
    await tx.trainingCourseQualification.upsert({
      where: { trainingCourseId_qualificationTypeId: { trainingCourseId: courseId, qualificationTypeId: typeId } },
      create: { organizationId: user.organizationId, trainingCourseId: courseId, qualificationTypeId: typeId, effect: effect.data }, update: { effect: effect.data },
    });
    await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.trainingCourseUpdated, entityType: "TrainingCourse", entityId: courseId, summary: `Course “${course.name}”: ${type.name} → ${effect.data}`, changes: [{ field: `qualification:${type.name}`, from: null, to: effect.data }] });
  }));
  return done(path, "Qualification linkage saved.");
}

export async function removeCourseQualification(form: FormData) {
  const user = await requireRole("ADMIN");
  await prisma.trainingCourseQualification.deleteMany({ where: { id: text(form, "id"), organizationId: user.organizationId } });
  return done("/administration/training-courses", "Linkage removed.");
}

// ------------------------------------------------------------------ sessions

async function sessionTimes(user: AuthenticatedUser, data: z.infer<typeof sessionSchema>) {
  const zone = await getViewerTimeZone(user);
  const startAt = zonedWallTimeToUtc(data.startDate, data.startTime, zone);
  let endAt: Date | null = null;
  if (data.endTime) endAt = zonedWallTimeToUtc(data.endDate || data.startDate, data.endTime, zone);
  else if (data.endDate) endAt = zonedWallTimeToUtc(data.endDate, data.startTime, zone);
  if (endAt && endAt < startAt) throw new svc.TrainingError("The end must not be before the start.");
  return { startAt, endAt };
}

function sessionInput(form: FormData) {
  return {
    trainingCourseId: text(form, "trainingCourseId"), titleOverride: text(form, "titleOverride"), startDate: text(form, "startDate"), startTime: text(form, "startTime"),
    endDate: text(form, "endDate"), endTime: text(form, "endTime"), location: text(form, "location"), instructor: text(form, "instructor"),
    providerOverride: text(form, "providerOverride"), maxParticipants: text(form, "maxParticipants"), notes: text(form, "notes"), status: text(form, "status") || "PLANNED",
  };
}

export async function createSession(form: FormData) {
  const user = await requireAuthenticatedUser();
  if (!canManageSessions(user)) redirect("/forbidden");
  const path = "/training/sessions/new";
  const parsed = sessionSchema.safeParse(sessionInput(form));
  if (!parsed.success) return fail(path, parsed.error.issues[0]?.message ?? "Invalid session.");
  const session = await run(path, async () => {
    const times = await sessionTimes(user, parsed.data);
    return prisma.$transaction(async (tx) => {
      const course = await tx.trainingCourse.findFirst({ where: { id: parsed.data.trainingCourseId, organizationId: user.organizationId, active: true } });
      if (!course) throw new svc.TrainingError("Choose an active course.");
      const { startDate, startTime, endDate, endTime, ...rest } = parsed.data; void startDate; void startTime; void endDate; void endTime;
      const created = await tx.trainingSession.create({ data: { ...rest, ...times, organizationId: user.organizationId, createdByUserId: user.id } });
      await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.trainingSessionCreated, entityType: "TrainingSession", entityId: created.id, summary: `Session for “${course.name}” scheduled`, metadata: { startAt: created.startAt, status: created.status } });
      return created;
    });
  });
  return done(`/training/sessions/${session.id}`, "Session created.");
}

export async function updateSession(form: FormData) {
  const user = await requireAuthenticatedUser();
  if (!canManageSessions(user)) redirect("/forbidden");
  const id = text(form, "id"), path = `/training/sessions/${id}`;
  const parsed = sessionSchema.safeParse(sessionInput(form));
  if (!parsed.success) return fail(path, parsed.error.issues[0]?.message ?? "Invalid session.");
  const moved = await run(path, async () => {
    const times = await sessionTimes(user, parsed.data);
    return prisma.$transaction(async (tx) => {
      const before = await tx.trainingSession.findFirst({ where: { id, organizationId: user.organizationId } });
      if (!before) throw new svc.TrainingError("Session not found.");
      if (before.status === "COMPLETED" || before.status === "CANCELLED") throw new svc.TrainingError("Closed sessions cannot be edited.");
      const { startDate, startTime, endDate, endTime, trainingCourseId, ...rest } = parsed.data; void startDate; void startTime; void endDate; void endTime; void trainingCourseId;
      const after = await tx.trainingSession.update({ where: { id }, data: { ...rest, ...times } });
      const changes = diffChanges(before, after, ["titleOverride", "startAt", "endAt", "location", "instructor", "maxParticipants", "status"]);
      if (changes.length) await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.trainingSessionUpdated, entityType: "TrainingSession", entityId: id, summary: "Training session updated", changes });
      return before.startAt.getTime() !== after.startAt.getTime() || before.location !== after.location;
    });
  });
  if (moved) await notifyTrainingSessionChanged({ organizationId: user.organizationId, sessionId: id, change: "rescheduled", actorUserId: user.id });
  return done(path, "Session updated.");
}

export async function enrollEmployees(form: FormData) {
  const user = await requireAuthenticatedUser();
  if (!canManageSessions(user)) redirect("/forbidden");
  const sessionId = text(form, "sessionId"), path = `/training/sessions/${sessionId}`;
  const ids = [...new Set(form.getAll("employeeId").map(String).filter(Boolean))];
  if (!ids.length) return fail(path, "Choose at least one employee.");
  const policy = await getTrainingPolicy(user.organizationId);
  for (const employeeId of ids) {
    await run(path, () => prisma.$transaction((tx) => svc.enrollEmployee(tx, user, policy, sessionId, employeeId)));
    await notifyTrainingEnrolled({ organizationId: user.organizationId, sessionId, employeeId, actorUserId: user.id });
  }
  return done(path, `${ids.length} participant${ids.length === 1 ? "" : "s"} enrolled.`);
}

export async function selfEnroll(form: FormData) {
  const user = await requireAuthenticatedUser();
  const sessionId = text(form, "sessionId"), path = `/training/sessions/${sessionId}`;
  if (!user.employeeId) return fail(path, "Your account is not linked to an employee.");
  const policy = await getTrainingPolicy(user.organizationId);
  await run(path, () => prisma.$transaction((tx) => svc.enrollEmployee(tx, user, policy, sessionId, user.employeeId!)));
  return done(path, "You are enrolled.");
}

export async function leaveSession(form: FormData) {
  const user = await requireAuthenticatedUser();
  const sessionId = text(form, "sessionId"), path = `/training/sessions/${sessionId}`;
  const staffTarget = isTrainingStaff(user) ? text(form, "employeeId") : "";
  const employeeId = staffTarget || user.employeeId;
  if (!employeeId) return fail(path, "Nothing to cancel.");
  await prisma.trainingEnrollment.updateMany({ where: { trainingSessionId: sessionId, employeeId, organizationId: user.organizationId, status: "ENROLLED", trainingSession: { status: { in: ["PLANNED", "OPEN"] } } }, data: { status: "CANCELLED" } });
  return done(path, "Enrollment cancelled.");
}

export async function saveOutcome(form: FormData) {
  const user = await requireAuthenticatedUser();
  if (!canManageSessions(user)) redirect("/forbidden");
  const sessionId = text(form, "sessionId"), path = `/training/sessions/${sessionId}`;
  const parsed = outcomeSchema.safeParse({
    status: text(form, "status"), completionDate: text(form, "completionDate"), hoursCompleted: text(form, "hoursCompleted"),
    score: text(form, "score"), passed: text(form, "passed"), notes: text(form, "notes"),
  });
  if (!parsed.success) return fail(path, parsed.error.issues[0]?.message ?? "Invalid entry.");
  const policy = await getTrainingPolicy(user.organizationId);
  const today = todayKey(await getViewerTimeZone(user));
  const result = await run(path, () => prisma.$transaction((tx) => svc.recordOutcome(tx, user, policy, text(form, "enrollmentId"), parsed.data, today)));
  revalidatePath(path);
  const extra = result.outcome?.created.length ? ` ${result.outcome.created.length} qualification${result.outcome.created.length === 1 ? "" : "s"} created for verification.` : result.outcome?.suggested.length ? " A qualification is suggested for this course." : "";
  return done(path, `Saved.${extra}`);
}

export async function completeSessionAction(form: FormData) {
  const user = await requireAuthenticatedUser();
  if (!canManageSessions(user)) redirect("/forbidden");
  const sessionId = text(form, "sessionId"), path = `/training/sessions/${sessionId}`;
  await run(path, () => prisma.$transaction((tx) => svc.completeSession(tx, user, sessionId, form.get("markNoShow") === "on")));
  return done(path, "Session completed.");
}

export async function cancelSessionAction(form: FormData) {
  const user = await requireAuthenticatedUser();
  if (!canManageSessions(user)) redirect("/forbidden");
  const sessionId = text(form, "sessionId"), path = `/training/sessions/${sessionId}`;
  await run(path, () => prisma.$transaction((tx) => svc.cancelSession(tx, user, sessionId, text(form, "reason").slice(0, 300) || null)));
  await notifyTrainingSessionChanged({ organizationId: user.organizationId, sessionId, change: "cancelled", actorUserId: user.id });
  return done(path, "Session cancelled; participants were notified.");
}

// ------------------------------------------------------------------ external records

export async function submitRecordAction(form: FormData) {
  const user = await requireAuthenticatedUser();
  const requested = text(form, "employeeId") || user.employeeId || "";
  const path = "/training/records/new";
  if (!requested || !canSubmitRecordFor(user, requested)) return fail(path, "You can only submit training for yourself.");
  const parsed = recordSchema.safeParse({
    employeeId: requested, trainingCourseId: text(form, "trainingCourseId"), courseName: text(form, "courseName"), provider: text(form, "provider"),
    completionDate: text(form, "completionDate"), hours: text(form, "hours"), certificateNumber: text(form, "certificateNumber"), notes: text(form, "notes"),
  });
  if (!parsed.success) return fail(path, parsed.error.issues[0]?.message ?? "Invalid record.");
  const today = todayKey(await getViewerTimeZone(user));
  const record = await run(path, () => prisma.$transaction((tx) => svc.submitRecord(tx, user, parsed.data, today)));
  const file = form.get("file");
  let attachmentNote = "";
  if (file instanceof File && file.size > 0) {
    try {
      await createDocument({ title: `Certificate — ${record.courseName}`, relationField: "trainingRecordId", relationId: record.id, file }, user);
    } catch (error) {
      attachmentNote = ` The certificate could not be attached: ${error instanceof Error ? error.message : "upload failed"}. You can add it from the record.`;
    }
  }
  await notifyTrainingVerificationNeeded({ organizationId: user.organizationId, recordId: record.id, actorUserId: user.id });
  return done(`/training/records/${record.id}`, `Submitted for verification.${attachmentNote}`);
}

export async function attachRecordDocument(form: FormData) {
  const user = await requireAuthenticatedUser();
  const recordId = text(form, "recordId"), path = `/training/records/${recordId}`;
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return fail(path, "Choose a file.");
  const record = await prisma.employeeTrainingRecord.findFirst({ where: { id: recordId, organizationId: user.organizationId }, select: { employeeId: true, courseName: true, verified: true } });
  if (!record || !canSubmitRecordFor(user, record.employeeId)) redirect("/forbidden");
  if (record!.verified && !isTrainingStaff(user)) return fail(path, "This record is already verified.");
  try {
    await createDocument({ title: text(form, "title") || `Certificate — ${record!.courseName}`, relationField: "trainingRecordId", relationId: recordId, file }, user);
  } catch (error) {
    return fail(path, error instanceof Error ? error.message : "Upload failed.");
  }
  return done(path, "Document attached.");
}

export async function attachSessionDocument(form: FormData) {
  const user = await requireAuthenticatedUser();
  if (!canManageSessions(user)) redirect("/forbidden");
  const sessionId = text(form, "sessionId"), path = `/training/sessions/${sessionId}`;
  const file = form.get("file");
  if (!(file instanceof File) || !file.size || !text(form, "title")) return fail(path, "A title and file are required.");
  try {
    await createDocument({ title: text(form, "title"), relationField: "trainingSessionId", relationId: sessionId, file }, user);
  } catch (error) {
    return fail(path, error instanceof Error ? error.message : "Upload failed.");
  }
  return done(path, "Document attached.");
}

export async function verifyRecordAction(form: FormData) {
  const user = await requireAuthenticatedUser();
  const id = text(form, "id"), path = `/training/records/${id}`;
  const policy = await getTrainingPolicy(user.organizationId);
  if (!canVerifyAny(user, policy)) redirect("/forbidden");
  const result = await run(path, () => prisma.$transaction((tx) => svc.verifyRecord(tx, user, policy, id)));
  const created = result.outcome.created.length;
  return done(path, created ? `Verified. ${created} unverified qualification${created === 1 ? "" : "s"} created for review.` : result.outcome.suggested.length ? "Verified. A qualification is suggested for this course." : "Verified.");
}

export async function rejectRecordAction(form: FormData) {
  const user = await requireAuthenticatedUser();
  const id = text(form, "id"), path = `/training/records/${id}`;
  const policy = await getTrainingPolicy(user.organizationId);
  if (!canVerifyAny(user, policy)) redirect("/forbidden");
  const reason = text(form, "reason").slice(0, 500);
  if (reason.length < 3) return fail(path, "Give the employee a short reason.");
  await run(path, () => prisma.$transaction((tx) => svc.rejectRecord(tx, user, policy, id, reason)));
  return done(path, "Record rejected.");
}

export async function createSuggestedQualificationAction(form: FormData) {
  const user = await requireAuthenticatedUser();
  const kind = text(form, "kind") === "record" ? "record" : "enrollment";
  const returnTo = text(form, "returnTo");
  const path = /^\/training\/(sessions|records)\/[0-9a-f-]{36}$/i.test(returnTo) ? returnTo : "/training";
  const policy = await getTrainingPolicy(user.organizationId);
  if (!isTrainingStaff(user)) redirect("/forbidden");
  await run(path, () => prisma.$transaction((tx) => svc.createSuggestedQualification(tx, user, policy, { kind, id: text(form, "id") }, text(form, "qualificationTypeId"))));
  return done(path, "Unverified qualification created. Verify it on the employee's profile.");
}

// ------------------------------------------------------------------ settings

export async function saveTrainingSettings(form: FormData) {
  const user = await requireRole("ADMIN");
  const path = "/administration/lifecycle";
  const days = Number(text(form, "trainingSessionReminderDays"));
  if (!Number.isInteger(days) || days < 0 || days > 30) return fail(path, "Reminder days must be between 0 and 30.");
  const data = {
    allowTrainingSelfEnrollment: form.get("allowTrainingSelfEnrollment") === "on",
    managersCanVerifyTraining: form.get("managersCanVerifyTraining") === "on",
    allowVerifiedQualificationFromTraining: form.get("allowVerifiedQualificationFromTraining") === "on",
    trainingSessionReminderDays: days,
  };
  await prisma.$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    await tx.organization.update({ where: { id: user.organizationId }, data });
    const changes = diffChanges(before, data, Object.keys(data));
    if (changes.length) await audit.record(tx, { organizationId: user.organizationId, actor: userActor(user), action: AUDIT_ACTIONS.trainingSettingsChanged, entityType: "Organization", entityId: user.organizationId, summary: "Training policy changed", changes });
  });
  return done(path, "Training settings saved.");
}
