/**
 * Training and equipment-maintenance checks against a real PostgreSQL.
 * Opt-in (writes data): INTEGRATION_TESTS=1 DATABASE_URL=... npm run test:integration
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import Module from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";

type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const originalLoad = loader._load;
loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
  return request === "server-only" ? {} : originalLoad.call(this, request, ...rest);
};

const enabled = process.env.INTEGRATION_TESTS === "1";
if (enabled) process.env.DOCUMENT_STORAGE_PATH = mkdtempSync(path.join(tmpdir(), "arcadia-docs-"));
const NOW = new Date("2026-10-15T15:00:00Z");
const TODAY = "2026-10-15";
type AuthUser = import("@/lib/auth/session").AuthenticatedUser;

describe("training and maintenance (database)", { skip: !enabled }, () => {
  let prisma: typeof import("@/lib/prisma").prisma;
  let training: typeof import("@/modules/training/service");
  let trainingAuth: typeof import("@/modules/training/authorization");
  let maint: typeof import("@/modules/maintenance/service");
  let maintAuth: typeof import("@/modules/maintenance/authorization");
  let reports: typeof import("@/modules/reports/run");
  let events: typeof import("@/modules/notifications/events");
  let jobs: typeof import("@/modules/notifications/jobs");
  let calendar: typeof import("@/modules/calendar/service");
  let documents: typeof import("@/modules/documents/service");
  let docAuth: typeof import("@/modules/documents/authorization");
  let money: typeof import("@/modules/ledger/money");

  const sfx = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  const users = {} as Record<"admin" | "manager" | "alice" | "bob" | "foreign", AuthUser>;
  let orgId = "";
  let tPolicy: Awaited<ReturnType<typeof import("@/modules/training/authorization").getTrainingPolicy>>;
  let mPolicy: Awaited<ReturnType<typeof import("@/modules/maintenance/authorization").getMaintenancePolicy>>;
  const dec = (value: string) => money.parseMoney(value)!;

  const run = async (user: AuthUser, id: string, params: Record<string, string> = {}) => {
    const prepared = await reports.prepareReport(user, id, params, { now: NOW, zone: "America/New_York", export: true });
    return prepared ? reports.runPrepared(prepared) : null;
  };
  const tx = <T,>(work: (client: import("@/generated/prisma/client").Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(work);
  const outcome = (status: "COMPLETED" | "ATTENDED" | "NO_SHOW" | "CANCELLED" | "ENROLLED", hours: string | null = null, completionDate = "2026-10-10") => ({ status, completionDate, hoursCompleted: hours ? dec(hours) : null, score: null, passed: null, notes: null });

  const openInput = (equipmentId: string, extra: Record<string, unknown> = {}) => ({
    equipmentId, type: "REPAIR" as const, description: "Hydraulic leak", scheduleId: null, place: "NONE" as const, status: "OPEN" as const, performedByEmployeeId: null, vendorName: null, meterReading: null, notes: null, ...extra,
  });
  const completeInput = (extra: Record<string, unknown> = {}) => ({
    workPerformed: "Replaced hose", cost: null, meterReading: null, vendorName: null, performedByEmployeeId: null, inspectionResult: null, conditionFound: null, finalCondition: null,
    postStatus: "KEEP" as const, nextServiceDate: "", nextServiceMeter: null, postCostToLedger: false, notes: null, ...extra,
  });

  before(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    training = await import("@/modules/training/service");
    trainingAuth = await import("@/modules/training/authorization");
    maint = await import("@/modules/maintenance/service");
    maintAuth = await import("@/modules/maintenance/authorization");
    reports = await import("@/modules/reports/run");
    events = await import("@/modules/notifications/events");
    jobs = await import("@/modules/notifications/jobs");
    calendar = await import("@/modules/calendar/service");
    documents = await import("@/modules/documents/service");
    docAuth = await import("@/modules/documents/authorization");
    money = await import("@/modules/ledger/money");

    const org = await prisma.organization.create({ data: { name: `Life org ${sfx}`, timezone: "America/New_York" } });
    const other = await prisma.organization.create({ data: { name: `Life other ${sfx}` } });
    orgId = org.id;
    const dept = await prisma.department.create({ data: { organizationId: orgId, name: `Dept ${sfx}` } });
    ids.dept = dept.id;
    const mk = async (key: keyof typeof users, role: "ADMIN" | "MANAGER" | "EMPLOYEE", organizationId = org.id, departmentId: string | null = null) => {
      const employee = await prisma.employee.create({ data: { organizationId, firstName: key, lastName: sfx, departmentId } });
      const user = await prisma.user.create({ data: { organizationId, employeeId: employee.id, email: `${key}-${sfx}@life.local`, passwordHash: "x", role } });
      ids[`${key}Employee`] = employee.id;
      users[key] = { id: user.id, organizationId, employeeId: employee.id, email: user.email, role, displayName: key };
    };
    await mk("admin", "ADMIN"); await mk("manager", "MANAGER"); await mk("alice", "EMPLOYEE", org.id, dept.id); await mk("bob", "EMPLOYEE"); await mk("foreign", "ADMIN", other.id);
    tPolicy = await trainingAuth.getTrainingPolicy(orgId);
    mPolicy = await maintAuth.getMaintenancePolicy(orgId);
  });

  after(async () => { await prisma?.$disconnect(); });

  // =============================================================== training

  test("courses, sessions and enrollment rules", async () => {
    const course = await prisma.trainingCourse.create({ data: { organizationId: orgId, name: `First Aid ${sfx}`, code: `FA-${sfx}`, provider: "Red Cross", defaultDurationHours: "8.00", deliveryMethod: "IN_PERSON" } });
    ids.course = course.id;
    await assert.rejects(() => prisma.trainingCourse.create({ data: { organizationId: orgId, name: `First Aid ${sfx}` } }), "course names are unique per organization");
    const qType = await prisma.qualificationType.create({ data: { organizationId: orgId, name: `FA Cert ${sfx}`, category: "CERTIFICATION", expirationBehavior: "CALCULATED", defaultValidityMonths: 24 } });
    ids.qType = qType.id;
    const open = await prisma.trainingSession.create({ data: { organizationId: orgId, trainingCourseId: course.id, startAt: new Date("2026-10-17T13:00:00Z"), endAt: new Date("2026-10-17T21:00:00Z"), location: "HQ", status: "OPEN", maxParticipants: 2, createdByUserId: users.admin.id } });
    const planned = await prisma.trainingSession.create({ data: { organizationId: orgId, trainingCourseId: course.id, startAt: new Date("2026-10-20T13:00:00Z"), status: "PLANNED", createdByUserId: users.admin.id } });
    Object.assign(ids, { open: open.id, planned: planned.id });

    // Employees enroll themselves only in OPEN sessions, and only when enabled.
    await tx((t) => training.enrollEmployee(t, users.alice, tPolicy, open.id, ids.aliceEmployee));
    await assert.rejects(() => tx((t) => training.enrollEmployee(t, users.alice, tPolicy, open.id, ids.aliceEmployee)), /Already enrolled/);
    await assert.rejects(() => tx((t) => training.enrollEmployee(t, users.alice, tPolicy, planned.id, ids.aliceEmployee)), /cannot enroll/);
    await assert.rejects(() => tx((t) => training.enrollEmployee(t, users.alice, tPolicy, open.id, ids.bobEmployee)), /cannot enroll/, "employees cannot enroll others");
    await assert.rejects(() => tx((t) => training.enrollEmployee(t, users.alice, { ...tPolicy, allowSelfEnrollment: false }, open.id, ids.aliceEmployee)));
    // Staff enroll anyone; capacity is enforced.
    await tx((t) => training.enrollEmployee(t, users.manager, tPolicy, open.id, ids.bobEmployee));
    await assert.rejects(() => tx((t) => training.enrollEmployee(t, users.manager, tPolicy, open.id, ids.managerEmployee)), /full/);
    await tx((t) => training.enrollEmployee(t, users.manager, tPolicy, planned.id, ids.aliceEmployee));
    assert.equal(await prisma.trainingEnrollment.count({ where: { trainingSessionId: open.id } }), 2);
  });

  test("attendance, actual hours and conservative qualification linkage", async () => {
    const enrollment = await prisma.trainingEnrollment.findFirstOrThrow({ where: { trainingSessionId: ids.open, employeeId: ids.aliceEmployee } });
    const bobEnrollment = await prisma.trainingEnrollment.findFirstOrThrow({ where: { trainingSessionId: ids.open, employeeId: ids.bobEmployee } });
    ids.aliceEnrollment = enrollment.id;

    // Link configured as SUGGEST (the default): completion creates nothing.
    await prisma.trainingCourseQualification.create({ data: { organizationId: orgId, trainingCourseId: ids.course, qualificationTypeId: ids.qType } });
    const suggested = await tx((t) => training.recordOutcome(t, users.manager, tPolicy, enrollment.id, outcome("COMPLETED", "7.5"), TODAY));
    assert.equal(suggested.enrollment.hoursCompleted?.toFixed(2), "7.50", "actual hours, not the 8h scheduled");
    assert.equal(suggested.outcome?.created.length, 0);
    assert.equal(suggested.outcome?.suggested.length, 1);
    assert.equal(await prisma.employeeQualification.count({ where: { employeeId: ids.aliceEmployee } }), 0);
    // A person can then create it, as unverified.
    const q = await tx((t) => training.createSuggestedQualification(t, users.manager, tPolicy, { kind: "enrollment", id: enrollment.id }, ids.qType));
    assert.equal(q.verificationStatus, "UNVERIFIED");
    await assert.rejects(() => tx((t) => training.createSuggestedQualification(t, users.manager, tPolicy, { kind: "enrollment", id: enrollment.id }, ids.qType)), /already exists/);

    // CREATE_VERIFIED is downgraded when organization policy does not allow it.
    await prisma.trainingCourseQualification.updateMany({ where: { trainingCourseId: ids.course }, data: { effect: "CREATE_VERIFIED" } });
    const noPolicy = await tx((t) => training.recordOutcome(t, users.manager, tPolicy, bobEnrollment.id, outcome("COMPLETED", "8"), TODAY));
    assert.equal(noPolicy.outcome?.created[0].verified, false);
    assert.equal(noPolicy.outcome?.created[0].downgraded, true);
    const bobQual = await prisma.employeeQualification.findFirstOrThrow({ where: { employeeId: ids.bobEmployee } });
    assert.equal(bobQual.verificationStatus, "UNVERIFIED");
    assert.equal(bobQual.expirationDate?.toISOString().slice(0, 10), "2028-10-10", "expiration calculated from the type");
    assert.equal((await prisma.trainingEnrollment.findUniqueOrThrow({ where: { id: bobEnrollment.id } })).employeeQualificationId, bobQual.id);
    // Re-saving a completed enrollment is idempotent.
    await tx((t) => training.recordOutcome(t, users.manager, tPolicy, bobEnrollment.id, outcome("COMPLETED", "8"), TODAY));
    assert.equal(await prisma.employeeQualification.count({ where: { employeeId: ids.bobEmployee } }), 1);
    // Verified only when explicitly allowed by policy.
    const carol = await prisma.employee.create({ data: { organizationId: orgId, firstName: "carol", lastName: sfx } });
    const session2 = await prisma.trainingSession.create({ data: { organizationId: orgId, trainingCourseId: ids.course, startAt: new Date("2026-10-01T13:00:00Z"), status: "PLANNED", createdByUserId: users.admin.id } });
    const e2 = await tx(async (t) => (await training.enrollEmployee(t, users.admin, { ...tPolicy, allowVerifiedQualification: true }, session2.id, carol.id)).enrollment);
    await tx((t) => training.recordOutcome(t, users.admin, { ...tPolicy, allowVerifiedQualification: true }, e2.id, outcome("COMPLETED", "8", "2026-10-01"), TODAY));
    assert.equal((await prisma.employeeQualification.findFirstOrThrow({ where: { employeeId: carol.id } })).verificationStatus, "VERIFIED");
    await assert.rejects(() => tx((t) => training.recordOutcome(t, users.admin, tPolicy, e2.id, outcome("COMPLETED", "8", "2099-01-01"), TODAY)), /future/);
    await prisma.trainingCourseQualification.updateMany({ where: { trainingCourseId: ids.course }, data: { effect: "NONE" } });
  });

  test("a session cannot be completed with unresolved participants, then closes cleanly", async () => {
    const session = await prisma.trainingSession.create({ data: { organizationId: orgId, trainingCourseId: ids.course, startAt: new Date("2026-10-05T13:00:00Z"), status: "PLANNED", createdByUserId: users.admin.id } });
    await tx((t) => training.enrollEmployee(t, users.admin, tPolicy, session.id, ids.aliceEmployee));
    await assert.rejects(() => tx((t) => training.completeSession(t, users.manager, session.id, false)), /still only enrolled/);
    await tx((t) => training.completeSession(t, users.manager, session.id, true));
    const e = await prisma.trainingEnrollment.findFirstOrThrow({ where: { trainingSessionId: session.id } });
    assert.equal(e.status, "NO_SHOW");
    assert.equal((await prisma.trainingSession.findUniqueOrThrow({ where: { id: session.id } })).status, "COMPLETED");
    await assert.rejects(() => tx((t) => training.completeSession(t, users.manager, session.id, true)), /already completed/);
    await assert.rejects(() => tx((t) => training.enrollEmployee(t, users.manager, tPolicy, session.id, ids.bobEmployee)), /closed/);
    const cancelled = await prisma.trainingSession.create({ data: { organizationId: orgId, trainingCourseId: ids.course, startAt: new Date("2026-12-05T13:00:00Z"), status: "OPEN", createdByUserId: users.admin.id } });
    await tx((t) => training.enrollEmployee(t, users.alice, tPolicy, cancelled.id, ids.aliceEmployee));
    await tx((t) => training.cancelSession(t, users.manager, cancelled.id, "weather"));
    assert.equal((await prisma.trainingEnrollment.findFirstOrThrow({ where: { trainingSessionId: cancelled.id } })).status, "CANCELLED");
  });

  test("external records: self-submission, verification rules and qualification effects", async () => {
    const input = { employeeId: ids.aliceEmployee, trainingCourseId: ids.course, courseName: "Outside first aid", provider: "St John", completionDate: "2026-09-01", hours: dec("6.25"), certificateNumber: "CERT-12345", notes: null };
    const record = await tx((t) => training.submitRecord(t, users.alice, input, TODAY));
    ids.record = record.id;
    assert.equal(record.verified, false);
    await assert.rejects(() => tx((t) => training.submitRecord(t, users.alice, { ...input, employeeId: ids.bobEmployee }, TODAY)), /only submit training for yourself/);
    await assert.rejects(() => tx((t) => training.submitRecord(t, users.alice, { ...input, completionDate: "2027-01-01" }, TODAY)), /future/);
    assert.ok((await tx((t) => training.submitRecord(t, users.manager, { ...input, employeeId: ids.bobEmployee }, TODAY))).id, "staff may enter records for others; still unverified");

    // Nobody verifies their own record, and managers only when the organization allows it.
    await assert.rejects(() => tx((t) => training.verifyRecord(t, users.alice, tPolicy, record.id)), /not allowed|own training/);
    await assert.rejects(() => tx((t) => training.verifyRecord(t, users.manager, tPolicy, record.id)), /not allowed/);
    const adminOwn = await tx((t) => training.submitRecord(t, users.admin, { ...input, employeeId: ids.adminEmployee, courseName: "Admin's own" }, TODAY));
    await assert.rejects(() => tx((t) => training.verifyRecord(t, users.admin, tPolicy, adminOwn.id)), /your own/, "even administrators cannot self-verify");

    // SUGGEST (the default) leaves qualifications alone on verification; CREATE_UNVERIFIED does not grant verification.
    await prisma.trainingCourseQualification.updateMany({ where: { trainingCourseId: ids.course }, data: { effect: "CREATE_UNVERIFIED" } });
    const before = await prisma.employeeQualification.count({ where: { employeeId: ids.aliceEmployee } });
    const verified = await tx((t) => training.verifyRecord(t, users.admin, tPolicy, record.id));
    assert.equal(verified.outcome.created.length, 1);
    assert.equal(await prisma.employeeQualification.count({ where: { employeeId: ids.aliceEmployee } }), before + 1);
    assert.equal((await prisma.employeeQualification.findFirstOrThrow({ where: { id: verified.outcome.qualificationId! } })).verificationStatus, "UNVERIFIED");
    await assert.rejects(() => tx((t) => training.verifyRecord(t, users.admin, tPolicy, record.id)), /already verified/);
    assert.equal(await prisma.employeeQualification.count({ where: { employeeId: ids.aliceEmployee } }), before + 1, "no duplicate qualification");

    // A manager can verify once permitted; rejection needs the same right and cannot touch verified records.
    const second = await tx((t) => training.submitRecord(t, users.bob, { ...input, employeeId: ids.bobEmployee, courseName: "Bob external" }, TODAY));
    await tx((t) => training.rejectRecord(t, users.manager, { ...tPolicy, managersCanVerify: true }, second.id, "Certificate unreadable"));
    assert.ok((await prisma.employeeTrainingRecord.findUniqueOrThrow({ where: { id: second.id } })).rejectedAt);
    await assert.rejects(() => tx((t) => training.rejectRecord(t, users.admin, tPolicy, record.id, "late")), /verified record cannot/);
    await prisma.trainingCourseQualification.updateMany({ where: { trainingCourseId: ids.course }, data: { effect: "NONE" } });
  });

  test("training visibility and documents", async () => {
    const aliceRecords = await prisma.employeeTrainingRecord.findMany({ where: trainingAuth.recordVisibilityWhere(users.alice) });
    assert.ok(aliceRecords.length > 0 && aliceRecords.every((r) => r.employeeId === ids.aliceEmployee));
    assert.ok((await prisma.employeeTrainingRecord.count({ where: trainingAuth.recordVisibilityWhere(users.manager) })) > aliceRecords.length);
    assert.equal(await prisma.employeeTrainingRecord.count({ where: trainingAuth.recordVisibilityWhere(users.foreign) }), 0);
    const sessionsForBob = await prisma.trainingSession.findMany({ where: trainingAuth.sessionVisibilityWhere(users.bob) });
    assert.ok(sessionsForBob.every((s) => s.status === "OPEN" || s.id === ids.open || s.id === ids.planned), "employees see open or own sessions");
    assert.ok(!sessionsForBob.some((s) => s.id === ids.planned), "a planned session Bob is not in is hidden");

    // Certificates reuse the shared Documents subsystem; only the owner (and staff verifiers) can attach or read.
    const bytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    const file = new File([bytes], "cert.pdf", { type: "application/pdf" });
    const doc = await documents.createDocument({ title: "Certificate", relationField: "trainingRecordId", relationId: ids.record, file }, users.alice);
    await assert.rejects(() => documents.createDocument({ title: "Forged", relationField: "trainingRecordId", relationId: ids.record, file }, users.bob), /access/);
    const visible = (user: AuthUser) => prisma.document.findFirst({ where: { id: doc.id, ...docAuth.documentVisibilityWhere(user) } });
    assert.ok(await visible(users.alice));
    assert.ok(await visible(users.manager));
    assert.equal(await visible(users.bob), null, "another employee cannot read the certificate");
    assert.equal(await visible(users.foreign), null);
  });

  test("training notifications, reminders and calendar", async () => {
    const countFor = (user: AuthUser, type: string) => prisma.notification.count({ where: { userId: user.id, type: type as never } });
    await events.notifyTrainingEnrolled({ organizationId: orgId, sessionId: ids.open, employeeId: ids.aliceEmployee, actorUserId: users.manager.id });
    await events.notifyTrainingEnrolled({ organizationId: orgId, sessionId: ids.open, employeeId: ids.aliceEmployee, actorUserId: users.manager.id });
    assert.equal(await countFor(users.alice, "TRAINING_ENROLLED"), 1, "no spam on repeat");
    await prisma.trainingSession.update({ where: { id: ids.planned }, data: { startAt: new Date("2026-10-21T13:00:00Z") } });
    await events.notifyTrainingSessionChanged({ organizationId: orgId, sessionId: ids.planned, change: "rescheduled", actorUserId: users.manager.id });
    assert.equal(await countFor(users.alice, "TRAINING_SESSION_CHANGED"), 1);
    // Verification requests go to administrators only (managers are not permitted to verify here).
    const pending = await prisma.employeeTrainingRecord.findFirstOrThrow({ where: { organizationId: orgId, verified: false, rejectedAt: null, employeeId: ids.bobEmployee } }).catch(() => null);
    const target = pending ?? (await tx((t) => training.submitRecord(t, users.bob, { employeeId: ids.bobEmployee, trainingCourseId: null, courseName: "Bob again", provider: "X", completionDate: "2026-08-01", hours: dec("2"), certificateNumber: null, notes: null }, TODAY)));
    await events.notifyTrainingVerificationNeeded({ organizationId: orgId, recordId: target.id, actorUserId: users.bob.id });
    assert.equal(await countFor(users.admin, "TRAINING_VERIFICATION_NEEDED"), 1);
    assert.equal(await countFor(users.manager, "TRAINING_VERIFICATION_NEEDED"), 0);
    assert.equal(await countFor(users.bob, "TRAINING_VERIFICATION_NEEDED"), 0, "never to the submitter");

    // Scheduled reminder: once per participant per start time, only inside the window.
    const soon = await prisma.trainingSession.create({ data: { organizationId: orgId, trainingCourseId: ids.course, startAt: new Date("2026-10-16T13:00:00Z"), status: "OPEN", createdByUserId: users.admin.id } });
    await tx((t) => training.enrollEmployee(t, users.alice, tPolicy, soon.id, ids.aliceEmployee));
    await jobs.runNotificationJobs({ now: NOW, organizationId: orgId });
    await jobs.runNotificationJobs({ now: new Date(NOW.getTime() + 3_600_000), organizationId: orgId });
    assert.equal(await prisma.notification.count({ where: { userId: users.alice.id, type: "TRAINING_SESSION_REMINDER", relatedEntityId: soon.id } }), 1);
    assert.equal(await prisma.notification.count({ where: { userId: users.alice.id, type: "TRAINING_SESSION_REMINDER", relatedEntityId: ids.open } }), 0, "outside the 2-day window");

    // Calendar shows sessions from the source table, scoped by role.
    const filters = { view: "month", anchor: TODAY, types: ["TRAINING"], mine: false, showCompleted: false } as never;
    const adminItems = (await calendar.getCalendarItems(users.admin, filters, { zone: "America/New_York", now: NOW })).items;
    assert.ok(adminItems.some((i) => i.key === `training:${ids.open}`) && adminItems.some((i) => i.key === `training:${ids.planned}`));
    const bobItems = (await calendar.getCalendarItems(users.bob, filters, { zone: "America/New_York", now: NOW })).items;
    assert.ok(bobItems.some((i) => i.key === `training:${ids.open}`));
    assert.ok(!bobItems.some((i) => i.key === `training:${ids.planned}`), "planned sessions are not shown to non-participants");
    assert.equal((await calendar.getCalendarItems(users.foreign, filters, { zone: "UTC", now: NOW })).items.length, 0);
    assert.equal(await prisma.calendarEvent.count({ where: { organizationId: orgId } }), 0, "nothing is copied into CalendarEvent");
  });

  test("training reports", async () => {
    const history = (await run(users.admin, "training-history"))!;
    assert.ok(history.total >= 4);
    const aliceHistory = (await run(users.alice, "training-history"))!;
    assert.ok(aliceHistory.rows.every((r) => String(r[0]).startsWith("alice")), "employees see only themselves");
    const hours = (await run(users.admin, "training-hours-by-employee", { from: "2026-01-01", to: "2026-12-31" }))!;
    const alice = hours.rows.find((r) => String(r[0]).startsWith("alice"))!;
    // 7.5 staff-recorded + 6.25 verified external = 13.75; no unverified for Alice.
    assert.deepEqual([alice[2], alice[3], alice[4]], ["13.75", "0.00", "13.75"]);
    const byCourse = (await run(users.admin, "training-hours-by-course", { from: "2026-01-01", to: "2026-12-31" }))!;
    assert.ok(byCourse.rows.some((r) => r[0] === `First Aid ${sfx}`));
    assert.ok(byCourse.rows.some((r) => r[0] === "Outside first aid"), "unmatched external names stay separate");
    const byDept = (await run(users.admin, "training-completed", { from: "2026-01-01", to: "2026-12-31", department: ids.dept }))!;
    assert.ok(byDept.total >= 1 && byDept.rows.every((r) => r[1] === `Dept ${sfx}`));
    const byCourseFilter = (await run(users.admin, "training-history", { course: ids.course }))!;
    assert.ok(byCourseFilter.total >= 1);
    const upcoming = (await run(users.alice, "upcoming-training-sessions"))!;
    assert.ok(upcoming.rows.length >= 1);
    const unverified = (await run(users.admin, "unverified-training"))!;
    assert.ok(unverified.total >= 1 && String(unverified.rows[0][2]).length > 0);
    assert.equal(await run(users.alice, "unverified-training"), null, "employees cannot see the verification queue");
    assert.equal((await run(users.foreign, "training-history"))!.total, 0);
  });

  // ============================================================ maintenance

  test("opening maintenance changes status only when asked, and flags rental conflicts", async () => {
    const generator = await prisma.equipment.create({ data: { organizationId: orgId, assetNumber: `G-${sfx}`, name: "Generator", meterUnit: "HOURS" } });
    const trailer = await prisma.equipment.create({ data: { organizationId: orgId, assetNumber: `T-${sfx}`, name: "Trailer" } });
    const camera = await prisma.equipment.create({ data: { organizationId: orgId, assetNumber: `C-${sfx}`, name: "Camera", status: "CHECKED_OUT" } });
    Object.assign(ids, { generator: generator.id, trailer: trailer.id, camera: camera.id });
    const rental = await prisma.rental.create({ data: { organizationId: orgId, rentalNumber: `R-${sfx}`, status: "RESERVED", reservationStart: new Date("2026-10-20T00:00:00Z"), reservationEnd: new Date("2026-10-25T00:00:00Z"), createdByUserId: users.manager.id, items: { create: { equipmentId: generator.id } } } });
    ids.rental = rental.id;

    const plain = await tx((t) => maint.openRecord(t, users.admin, mPolicy, openInput(trailer.id)));
    assert.equal((await prisma.equipment.findUniqueOrThrow({ where: { id: trailer.id } })).status, "AVAILABLE", "opening a record does not move equipment unless asked");

    const placed = await tx((t) => maint.openRecord(t, users.admin, mPolicy, openInput(generator.id, { place: "MAINTENANCE", status: "IN_PROGRESS", meterReading: dec("120.5") })));
    ids.genRecord = placed.record.id;
    assert.equal((await prisma.equipment.findUniqueOrThrow({ where: { id: generator.id } })).status, "MAINTENANCE");
    assert.equal(placed.record.equipmentStatusApplied, "MAINTENANCE");
    assert.ok(placed.record.unavailableAt);
    assert.equal(placed.conflicts.length, 1, "the reserved rental is flagged");
    assert.equal(placed.conflicts[0].rentalNumber, `R-${sfx}`);
    assert.equal((await prisma.rental.findUniqueOrThrow({ where: { id: rental.id } })).status, "RESERVED", "the rental is not touched");
    assert.equal(await prisma.rentalItem.count({ where: { rentalId: rental.id, equipmentId: generator.id } }), 1, "no automatic substitution");

    await assert.rejects(() => tx((t) => maint.openRecord(t, users.admin, mPolicy, openInput(camera.id, { place: "OUT_OF_SERVICE" }))), /checked out/);
    await assert.rejects(() => tx((t) => maint.openRecord(t, users.admin, mPolicy, openInput(trailer.id, { meterReading: dec("5") }))), /does not track a meter/);
    await tx((t) => maint.placeEquipment(t, users.admin, mPolicy, plain.record.id, "OUT_OF_SERVICE"));
    assert.equal((await prisma.equipment.findUniqueOrThrow({ where: { id: trailer.id } })).status, "OUT_OF_SERVICE");
  });

  test("permissions: employees report, managers manage per policy, nobody outside the org", async () => {
    const report = await tx((t) => maint.openRecord(t, users.bob, mPolicy, openInput(ids.camera, { type: "DAMAGE", description: "Cracked lens" })));
    assert.equal(report.record.status, "OPEN");
    await assert.rejects(() => tx((t) => maint.openRecord(t, users.bob, mPolicy, openInput(ids.trailer, { place: "MAINTENANCE" }))), /cannot change equipment status|Reporting/);
    await assert.rejects(() => tx((t) => maint.openRecord(t, users.bob, mPolicy, openInput(ids.trailer, { type: "INSPECTION" }))), /damage, repair or other/);
    await assert.rejects(() => tx((t) => maint.openRecord(t, users.bob, { ...mPolicy, employeesCanReport: false }, openInput(ids.trailer, { type: "DAMAGE" }))), /cannot open/);
    await assert.rejects(() => tx((t) => maint.changeStatus(t, users.bob, mPolicy, report.record.id, "IN_PROGRESS")), /cannot change/);
    await assert.rejects(() => tx((t) => maint.completeRecord(t, users.bob, mPolicy, report.record.id, completeInput())), /cannot complete/);
    await assert.rejects(() => tx((t) => maint.completeRecord(t, users.manager, { ...mPolicy, managersCanManage: false }, report.record.id, completeInput())), /cannot complete/);
    assert.equal(maintAuth.canSeeMaintenanceCost(users.bob), false);
    assert.equal(maintAuth.canPostCostToLedger(users.manager), false);
    await assert.rejects(() => tx((t) => maint.completeRecord(t, users.foreign, mPolicy, report.record.id, completeInput())), /not found/, "organization isolation");
    await assert.rejects(() => tx((t) => maint.openRecord(t, users.foreign, mPolicy, openInput(ids.generator))), /Equipment not found/);
    // Employees can attach a photo only to a record they reported.
    const bytes = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    await documents.createDocument({ title: "Photo", relationField: "maintenanceRecordId", relationId: report.record.id, file: new File([bytes], "p.pdf", { type: "application/pdf" }) }, users.bob);
    await assert.rejects(() => documents.createDocument({ title: "Photo", relationField: "maintenanceRecordId", relationId: report.record.id, file: new File([bytes], "p.pdf", { type: "application/pdf" }) }, users.alice), /access/);
    ids.camReport = report.record.id;
  });

  test("completing work never silently returns equipment to service", async () => {
    // Keep status: equipment stays in maintenance.
    const kept = await tx((t) => maint.completeRecord(t, users.admin, mPolicy, ids.genRecord, completeInput({ cost: dec("150.25"), meterReading: dec("130.0"), nextServiceDate: "2026-11-30", nextServiceMeter: dec("250.0") })));
    assert.equal((await prisma.equipment.findUniqueOrThrow({ where: { id: ids.generator } })).status, "MAINTENANCE");
    assert.equal(kept.returned, false);
    assert.ok(kept.record.completedAt);
    assert.equal(kept.record.cost?.toFixed(2), "150.25");
    assert.equal(kept.record.returnedToServiceAt, null);
    // Next-service data flows into a schedule so due logic has one source of truth.
    const schedule = await prisma.maintenanceSchedule.findFirstOrThrow({ where: { equipmentId: ids.generator } });
    assert.equal(schedule.nextServiceDate?.toISOString().slice(0, 10), "2026-11-30");
    assert.equal(schedule.nextServiceMeter?.toFixed(1), "250.0");
    await assert.rejects(() => tx((t) => maint.completeRecord(t, users.admin, mPolicy, ids.genRecord, completeInput())), /already closed/);

    // An explicit follow-up is required to return it: new inspection that must pass.
    const inspection = await tx((t) => maint.openRecord(t, users.admin, mPolicy, openInput(ids.generator, { type: "INSPECTION", description: "Post-repair inspection" })));
    await assert.rejects(() => tx((t) => maint.completeRecord(t, users.admin, mPolicy, inspection.record.id, completeInput({ postStatus: "AVAILABLE" }))), /inspection result/);
    await assert.rejects(() => tx((t) => maint.completeRecord(t, users.admin, mPolicy, inspection.record.id, completeInput({ postStatus: "AVAILABLE", inspectionResult: "FAIL" }))), /failed inspection/);
    const done = await tx((t) => maint.completeRecord(t, users.admin, mPolicy, inspection.record.id, completeInput({ postStatus: "AVAILABLE", inspectionResult: "PASS", conditionFound: "GOOD", workPerformed: "Pressure test OK" })));
    assert.equal((await prisma.equipment.findUniqueOrThrow({ where: { id: ids.generator } })).status, "AVAILABLE");
    assert.equal(done.record.inspectionResult, "PASS");
    assert.equal(done.returned, true);
    assert.ok(done.record.returnedToServiceAt === null || done.record.returnedToServiceAt, "inspection record itself did not place the asset");
    const audits = (await prisma.auditEvent.findMany({ where: { organizationId: orgId, action: { startsWith: "equipment." } } })).map((a) => a.action);
    assert.ok(audits.includes("equipment.unavailable") && audits.includes("equipment.returned_to_service"));

    // Another open record holding the asset blocks return to service.
    const a = await tx((t) => maint.openRecord(t, users.admin, mPolicy, openInput(ids.generator, { place: "OUT_OF_SERVICE", description: "Engine seized" })));
    const b = await tx((t) => maint.openRecord(t, users.admin, mPolicy, openInput(ids.generator, { description: "Paint touch-up" })));
    await assert.rejects(() => tx((t) => maint.completeRecord(t, users.admin, mPolicy, b.record.id, completeInput({ postStatus: "AVAILABLE" }))), /AVAILABLE|still holds|Another open/);
    // Cancelling the holder requires an explicit decision too, and completing it with AVAILABLE returns it.
    const finished = await tx((t) => maint.completeRecord(t, users.admin, mPolicy, a.record.id, completeInput({ postStatus: "AVAILABLE", workPerformed: "Engine replaced" })));
    assert.ok(finished.record.returnedToServiceAt);
    assert.equal((await prisma.equipment.findUniqueOrThrow({ where: { id: ids.generator } })).status, "AVAILABLE");
    ids.paintRecord = b.record.id;
  });

  test("equipment owned by the rental workflow is not overridden by maintenance completion", async () => {
    const reserved = await prisma.equipment.create({ data: { organizationId: orgId, assetNumber: `V-${sfx}`, name: "Van", status: "RESERVED" } });
    const rec = await tx((t) => maint.openRecord(t, users.admin, mPolicy, openInput(reserved.id, { description: "Check lights" })));
    const result = await tx((t) => maint.completeRecord(t, users.admin, mPolicy, rec.record.id, completeInput({ postStatus: "AVAILABLE" })));
    assert.equal((await prisma.equipment.findUniqueOrThrow({ where: { id: reserved.id } })).status, "RESERVED");
    assert.match(result.statusNote ?? "", /rental workflow/);
  });

  test("meters and service schedules drive derived due states", async () => {
    const { evaluateDue } = await import("@/modules/maintenance/due");
    const { loadDueItems } = await import("@/modules/maintenance/data");
    await assert.rejects(() => tx((t) => maint.recordMeter(t, users.admin, ids.trailer, dec("10"), null, null, true, mPolicy)), /does not track a meter/);
    await assert.rejects(() => tx((t) => maint.recordMeter(t, users.admin, ids.generator, dec("100"), null, null, true, mPolicy)), /cannot be lower/);
    await tx((t) => maint.recordMeter(t, users.admin, ids.generator, dec("240.0"), "weekly check", null, true, mPolicy));
    await assert.rejects(() => tx((t) => maint.recordMeter(t, users.bob, ids.generator, dec("300"), null, null, true, mPolicy)), /cannot record/);

    // Annual inspection by date (overdue) and a service every 250 hours.
    await tx((t) => maint.saveSchedule(t, users.admin, mPolicy, { id: null, equipmentId: ids.trailer, type: "INSPECTION", title: "Annual inspection", intervalDays: null, intervalMonths: 12, intervalMeter: null, lastServiceDate: "2025-09-01", nextServiceDate: "", nextServiceMeter: null, lastServiceMeter: null, responsibleEmployeeId: null, active: true }));
    const trailerSchedule = await prisma.maintenanceSchedule.findFirstOrThrow({ where: { equipmentId: ids.trailer } });
    assert.equal(trailerSchedule.nextServiceDate?.toISOString().slice(0, 10), "2026-09-01", "next date computed from last service + 12 months");
    await assert.rejects(() => tx((t) => maint.saveSchedule(t, users.admin, mPolicy, { id: null, equipmentId: ids.trailer, type: "PREVENTIVE", title: null, intervalDays: null, intervalMonths: null, intervalMeter: dec("250"), lastServiceDate: "", nextServiceDate: "", nextServiceMeter: null, lastServiceMeter: null, responsibleEmployeeId: null, active: true })), /meter unit/);
    await tx((t) => maint.saveSchedule(t, users.admin, mPolicy, { id: null, equipmentId: ids.generator, type: "PREVENTIVE", title: "250h service", intervalDays: null, intervalMonths: null, intervalMeter: dec("250"), lastServiceDate: "2026-10-01", nextServiceDate: "", nextServiceMeter: null, lastServiceMeter: dec("0"), responsibleEmployeeId: ids.aliceEmployee, active: true }));
    const meterSchedule = await prisma.maintenanceSchedule.findFirstOrThrow({ where: { equipmentId: ids.generator, title: "250h service" } });
    assert.equal(meterSchedule.nextServiceMeter?.toFixed(1), "250.0");

    const items = await loadDueItems(users.admin, mPolicy, {}, "America/New_York", NOW);
    const byId = (id: string) => items.find((i) => i.id === id)!;
    assert.equal(byId(trailerSchedule.id).due.state, "OVERDUE");
    assert.equal(byId(meterSchedule.id).due.state, "DUE_SOON", "240 of 250 hours is within 10%");
    await tx((t) => maint.recordMeter(t, users.admin, ids.generator, dec("251.0"), null, null, true, mPolicy));
    assert.equal((await loadDueItems(users.admin, mPolicy, {}, "America/New_York", NOW)).find((i) => i.id === meterSchedule.id)!.due.state, "OVERDUE");
    assert.equal(evaluateDue({ today: TODAY, dueSoonDays: 14, meterWarningPercent: 10, nextServiceDate: new Date("2026-11-30T00:00:00Z") }).state, "OK");
    ids.trailerSchedule = trailerSchedule.id; ids.meterSchedule = meterSchedule.id;

    // Completing work linked to a schedule rolls it forward from the interval.
    const rec = await tx((t) => maint.openRecord(t, users.admin, mPolicy, openInput(ids.generator, { type: "PREVENTIVE", description: "250h service", scheduleId: meterSchedule.id })));
    await tx((t) => maint.completeRecord(t, users.admin, mPolicy, rec.record.id, completeInput({ postStatus: "KEEP", meterReading: dec("255.0") })));
    const rolled = await prisma.maintenanceSchedule.findUniqueOrThrow({ where: { id: meterSchedule.id } });
    assert.equal(rolled.nextServiceMeter?.toFixed(1), "505.0");
    assert.equal(rolled.lastServiceMeter?.toFixed(1), "255.0");
    assert.equal((await loadDueItems(users.admin, mPolicy, {}, "America/New_York", NOW)).find((i) => i.id === meterSchedule.id)!.due.state, "OK");
  });

  test("maintenance notifications are targeted and idempotent; calendar shows the next service", async () => {
    const countFor = (user: AuthUser, type: string) => prisma.notification.count({ where: { userId: user.id, type: type as never } });
    const before = await countFor(users.manager, "EQUIPMENT_UNAVAILABLE");
    await events.notifyEquipmentUnavailable({ organizationId: orgId, equipmentId: ids.generator, status: "MAINTENANCE", actorUserId: users.admin.id, maintenanceRecordId: ids.genRecord });
    await events.notifyEquipmentUnavailable({ organizationId: orgId, equipmentId: ids.generator, status: "MAINTENANCE", actorUserId: users.admin.id, maintenanceRecordId: ids.genRecord });
    assert.equal(await countFor(users.manager, "EQUIPMENT_UNAVAILABLE"), before + 1, "the rental's owner is told once");
    assert.equal(await countFor(users.bob, "EQUIPMENT_UNAVAILABLE"), 0, "unrelated people are not");
    await events.notifyMaintenanceCompleted({ organizationId: orgId, recordId: ids.genRecord, actorUserId: users.manager.id });
    assert.equal(await countFor(users.admin, "MAINTENANCE_COMPLETED"), 1, "the creator hears about it, not the actor");

    await jobs.runNotificationJobs({ now: NOW, organizationId: orgId });
    const overdueNow = await prisma.notification.findMany({ where: { userId: users.admin.id, type: "MAINTENANCE_OVERDUE" } });
    await jobs.runNotificationJobs({ now: new Date(NOW.getTime() + 3_600_000), organizationId: orgId });
    // The trailer's annual inspection is overdue and has no responsible person: administrators are told once per schedule.
    assert.ok(overdueNow.some((n) => /Annual inspection/.test(n.message)));
    assert.equal(await prisma.notification.count({ where: { userId: users.admin.id, type: "MAINTENANCE_OVERDUE" } }), overdueNow.length, "re-running creates nothing new");
    assert.equal(new Set(overdueNow.map((n) => n.dedupeKey)).size, overdueNow.length);
    assert.equal(await prisma.notification.count({ where: { userId: users.bob.id, type: { in: ["MAINTENANCE_OVERDUE", "MAINTENANCE_DUE_SOON"] } } }), 0);

    const filters = { view: "month", anchor: "2026-11-15", types: ["MAINTENANCE"], mine: false, showCompleted: false } as never;
    const items = (await calendar.getCalendarItems(users.admin, filters, { zone: "America/New_York", now: NOW })).items;
    assert.ok(items.some((i) => i.key.startsWith("maintenance:") && i.startKey === "2026-11-30"), "the schedule's date appears without being copied");
    assert.equal((await calendar.getCalendarItems(users.bob, filters, { zone: "UTC", now: NOW })).items.length, 0, "employees only see schedules they are responsible for");
  });

  test("maintenance costs reach the ledger only deliberately, once", async () => {
    const withCost = await tx((t) => maint.openRecord(t, users.admin, mPolicy, openInput(ids.trailer, { description: "Replace axle" })));
    const completed = await tx((t) => maint.completeRecord(t, users.admin, mPolicy, withCost.record.id, completeInput({ cost: dec("1234.56") })));
    assert.equal(completed.ledgerId, null, "off by default");
    assert.equal(await prisma.ledgerTransaction.count({ where: { maintenanceRecordId: withCost.record.id } }), 0);
    const entry = await tx((t) => maint.postCostToLedger(t, users.admin, withCost.record.id));
    const again = await tx((t) => maint.postCostToLedger(t, users.admin, withCost.record.id));
    assert.equal(again.id, entry.id);
    assert.equal(await prisma.ledgerTransaction.count({ where: { maintenanceRecordId: withCost.record.id } }), 1);
    assert.equal(entry.type, "EXPENSE");
    assert.equal(entry.amount.toFixed(2), "1234.56");
    assert.equal(entry.equipmentId, ids.trailer);
    // Automatic posting is a per-organization choice and is idempotent with explicit posting.
    const auto = await tx((t) => maint.openRecord(t, users.admin, mPolicy, openInput(ids.trailer, { description: "Tires" })));
    const autoDone = await tx((t) => maint.completeRecord(t, users.admin, { ...mPolicy, autoPostCost: true }, auto.record.id, completeInput({ cost: dec("80.10") })));
    assert.ok(autoDone.ledgerId);
    await tx((t) => maint.postCostToLedger(t, users.admin, auto.record.id));
    assert.equal(await prisma.ledgerTransaction.count({ where: { maintenanceRecordId: auto.record.id } }), 1);
    const free = await tx((t) => maint.openRecord(t, users.admin, mPolicy, openInput(ids.trailer, { description: "Wipe down" })));
    await tx((t) => maint.completeRecord(t, users.admin, { ...mPolicy, autoPostCost: true }, free.record.id, completeInput()));
    assert.equal(await prisma.ledgerTransaction.count({ where: { maintenanceRecordId: free.record.id } }), 0, "no cost, no ledger entry");
    await assert.rejects(() => tx((t) => maint.postCostToLedger(t, users.admin, free.record.id)), /no cost/);
  });

  test("maintenance reports: history, open, overdue, cost and downtime", async () => {
    const open = (await run(users.bob, "open-maintenance"))!;
    assert.ok(open.rows.some((r) => r[3] === "Cracked lens"), "employees may view open maintenance");
    assert.ok(!open.columns.some((c) => /cost/i.test(c.label)));
    const history = (await run(users.admin, "maintenance-history", { from: "2026-01-01", to: "2026-12-31" }))!;
    assert.ok(history.total >= 8);
    assert.equal(await run(users.bob, "maintenance-history"), null);
    assert.equal(await run(users.bob, "maintenance-cost-by-equipment"), null);
    assert.equal(await run(users.bob, "maintenance-cost-by-category"), null);
    const overdue = (await run(users.bob, "overdue-maintenance"))!;
    assert.ok(overdue.rows.some((r) => r[0] === `T-${sfx}`));
    const cost = (await run(users.admin, "maintenance-cost-by-equipment", { from: "2026-01-01", to: "2026-12-31" }))!;
    const trailerRow = cost.rows.find((r) => r[0] === `T-${sfx}`)!;
    assert.equal(trailerRow[3], "1314.66", "1234.56 + 80.10 exactly");
    const generatorRow = cost.rows.find((r) => r[0] === `G-${sfx}`)!;
    assert.equal(generatorRow[3], "150.25");
    assert.equal(cost.summary![0].value, "1464.91");
    const byCategory = (await run(users.manager, "maintenance-cost-by-category", { from: "2026-01-01", to: "2026-12-31" }))!;
    assert.equal(byCategory.rows[0][0], "Uncategorized");
    assert.equal(byCategory.rows[0][2], "1464.91");
    assert.equal(byCategory.rows.length, 1);
    assert.equal((await run(users.foreign, "maintenance-cost-by-equipment", { from: "2026-01-01", to: "2026-12-31" }))!.rows.length, 0);
    const filtered = (await run(users.admin, "maintenance-history", { from: "2026-01-01", to: "2026-12-31", maintenanceType: "INSPECTION" }))!;
    assert.ok(filtered.rows.every((r) => r[3] === "Inspection"));

    // Downtime: a fixed, known interval is merged and clipped to the period.
    const eq = await prisma.equipment.create({ data: { organizationId: orgId, assetNumber: `D-${sfx}`, name: "Downtime test" } });
    const span = (from: string, to: string | null) => prisma.maintenanceRecord.create({ data: { organizationId: orgId, equipmentId: eq.id, type: "REPAIR", status: "COMPLETED", description: "x", createdByUserId: users.admin.id, equipmentStatusApplied: "OUT_OF_SERVICE", unavailableAt: new Date(from), returnedToServiceAt: to ? new Date(to) : null, completedAt: to ? new Date(to) : new Date(from) } });
    await span("2026-10-01T00:00:00Z", "2026-10-04T00:00:00Z"); // 3 days
    await span("2026-10-03T00:00:00Z", "2026-10-06T00:00:00Z"); // overlaps -> merged to 5 days total
    await span("2026-09-29T00:00:00Z", "2026-10-02T00:00:00Z"); // starts before the period; clipped
    const down = (await run(users.admin, "equipment-downtime", { from: "2026-10-01", to: "2026-10-10", equipment: eq.id }))!;
    const row = down.rows[0];
    assert.deepEqual([row[2], row[3]], [1, "5.0"], "merged overlapping periods, clipped to the report range");
  });

  test("audit trail for training and maintenance", async () => {
    const actions = new Set((await prisma.auditEvent.findMany({ where: { organizationId: orgId }, select: { action: true } })).map((e) => e.action));
    for (const expected of ["training.record.submitted", "training.record.verified", "training.record.rejected", "training.session.completed", "training.session.cancelled", "training.enrollment.completed", "maintenance.opened", "maintenance.completed", "maintenance.schedule.saved", "equipment.unavailable", "equipment.returned_to_service", "ledger.created"]) {
      assert.ok(actions.has(expected), `missing audit action ${expected}`);
    }
    const raw = JSON.stringify(await prisma.auditEvent.findMany({ where: { organizationId: orgId } }));
    assert.ok(!raw.includes("CERT-12345"), "certificate numbers are never audited");
  });
});
