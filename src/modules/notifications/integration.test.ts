/**
 * End-to-end checks of calendar aggregation, source-record authorization, notification
 * generation, idempotency, preferences and organization isolation against a real PostgreSQL.
 *
 * Opt-in (it writes data): INTEGRATION_TESTS=1 DATABASE_URL=... npm run test:integration
 * Run against a throwaway database only.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Module from "node:module";
import test, { after, before, describe } from "node:test";

// `server-only` throws outside the Next.js server bundle; the policy modules under test import it.
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const originalLoad = loader._load;
loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
  return request === "server-only" ? {} : originalLoad.call(this, request, ...rest);
};

const enabled = process.env.INTEGRATION_TESTS === "1";
const NOW = new Date("2026-10-15T15:00:00Z");
const MONTH = { view: "month", anchor: "2026-10-15", types: [], mine: false, showCompleted: false } as const;

type Prisma = typeof import("@/lib/prisma").prisma;
type AuthUser = import("@/lib/auth/session").AuthenticatedUser;

describe("calendar and notifications (database)", { skip: !enabled }, () => {
  let prisma: Prisma;
  let calendar: typeof import("@/modules/calendar/service");
  let jobs: typeof import("@/modules/notifications/jobs");
  let svc: typeof import("@/modules/notifications/service");
  let events: typeof import("@/modules/notifications/events");

  const sfx = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  const users: Record<"admin" | "manager" | "employee" | "outsider" | "foreign", AuthUser> = {} as never;
  let orgId = "";

  const itemKeys = async (user: AuthUser, extra: Record<string, unknown> = {}, zone = "America/New_York") =>
    (await calendar.getCalendarItems(user, { ...MONTH, ...extra } as never, { zone, now: NOW })).items;
  const findKey = (items: Array<{ key: string; startKey: string }>, key: string) => items.find((item) => item.key === key);

  before(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    calendar = await import("@/modules/calendar/service");
    jobs = await import("@/modules/notifications/jobs");
    svc = await import("@/modules/notifications/service");
    events = await import("@/modules/notifications/events");

    const org = await prisma.organization.create({ data: { name: `Test org ${sfx}`, timezone: "America/New_York" } });
    const other = await prisma.organization.create({ data: { name: `Other org ${sfx}` } });
    orgId = org.id;
    const mk = async (key: keyof typeof users, role: "ADMIN" | "MANAGER" | "EMPLOYEE", organizationId = org.id) => {
      const employee = await prisma.employee.create({ data: { organizationId, firstName: key, lastName: sfx } });
      const user = await prisma.user.create({ data: { organizationId, employeeId: employee.id, email: `${key}-${sfx}@test.local`, passwordHash: "x", role } });
      ids[`${key}Employee`] = employee.id;
      users[key] = { id: user.id, organizationId, employeeId: employee.id, email: user.email, role, displayName: key };
    };
    await mk("admin", "ADMIN"); await mk("manager", "MANAGER"); await mk("employee", "EMPLOYEE"); await mk("outsider", "EMPLOYEE");
    await mk("foreign", "ADMIN", other.id);

    const client = await prisma.client.create({ data: { organizationId: orgId, name: `Client ${sfx}`, createdByUserId: users.manager.id } });
    const project = await prisma.project.create({
      data: {
        organizationId: orgId, name: `Project ${sfx}`, clientId: client.id, projectManagerId: ids.managerEmployee,
        startDate: new Date("2026-10-05T00:00:00Z"), targetEndDate: new Date("2026-10-30T00:00:00Z"),
        members: { create: { organizationId: orgId, employeeId: ids.employeeEmployee } },
      },
    });
    Object.assign(ids, { client: client.id, project: project.id });
    await prisma.projectMilestone.create({ data: { organizationId: orgId, projectId: project.id, name: "Milestone A", targetDate: new Date("2026-10-20T00:00:00Z") } });

    const task = (title: string, due: string, employee: string | null, projectId: string | null = null) =>
      prisma.task.create({
        data: { organizationId: orgId, title, dueDate: new Date(`${due}T12:00:00Z`), assignedToEmployeeId: employee, projectId, createdByUserId: users.admin.id },
      });
    ids.taskOverdue = (await task("Overdue task", "2026-10-14", ids.employeeEmployee, project.id)).id;
    ids.taskTomorrow = (await task("Tomorrow task", "2026-10-16", ids.employeeEmployee, project.id)).id;
    ids.taskSoon = (await task("Soon task", "2026-10-20", ids.employeeEmployee)).id;
    ids.taskOther = (await task("Outsider task", "2026-10-18", ids.outsiderEmployee)).id;

    const type = await prisma.qualificationType.create({ data: { organizationId: orgId, name: `CPR ${sfx}`, category: "CERTIFICATION" } });
    const qual = (employeeId: string, exp: string) =>
      prisma.employeeQualification.create({ data: { organizationId: orgId, employeeId, qualificationTypeId: type.id, expirationDate: new Date(`${exp}T00:00:00Z`) } });
    ids.qualOwn = (await qual(ids.employeeEmployee, "2026-10-25")).id;
    ids.qualOther = (await qual(ids.outsiderEmployee, "2026-10-26")).id;
    ids.qualExpired = (await qual(ids.employeeEmployee, "2026-10-10")).id;

    ids.rental = (await prisma.rental.create({
      data: {
        organizationId: orgId, rentalNumber: `R-${sfx}`, clientId: client.id, projectId: project.id, status: "CHECKED_OUT",
        reservationStart: new Date("2026-10-10T14:00:00Z"), reservationEnd: new Date("2026-10-12T22:00:00Z"),
        checkedOutAt: new Date("2026-10-10T14:30:00Z"), checkedOutByEmployeeId: ids.managerEmployee, createdByUserId: users.manager.id,
      },
    })).id;

    const invoice = (number: string, due: string) =>
      prisma.invoice.create({
        data: {
          organizationId: orgId, invoiceNumber: number, clientId: client.id, projectId: project.id, status: "SENT",
          dueDate: new Date(`${due}T12:00:00Z`), balanceDue: "100.00", total: "100.00", createdByUserId: users.manager.id,
        },
      });
    ids.invoiceSoon = (await invoice(`INV-${sfx}-1`, "2026-10-22")).id;
    ids.invoiceLate = (await invoice(`INV-${sfx}-2`, "2026-10-10")).id;

    const doc = await prisma.document.create({ data: { organizationId: orgId, title: "Contract", createdByUserId: users.manager.id } });
    const version = await prisma.documentVersion.create({
      data: { organizationId: orgId, documentId: doc.id, versionNumber: 1, originalFilename: "c.pdf", storageKey: `k-${sfx}`, mimeType: "application/pdf", sizeBytes: 1, checksum: "x", uploadedByUserId: users.manager.id },
    });
    await prisma.documentRelation.create({ data: { organizationId: orgId, documentId: doc.id, projectId: project.id } });
    ids.document = doc.id;
    ids.signature = (await prisma.signatureRequest.create({
      data: {
        organizationId: orgId, documentId: doc.id, documentVersionId: version.id, title: "Sign contract", status: "SENT",
        requestedByUserId: users.manager.id, expiresAt: new Date("2026-10-27T03:00:00Z"),
        signers: { create: { organizationId: orgId, employeeId: ids.employeeEmployee, name: "E", email: "e@test.local" } },
      },
    })).id;
    ids.approval = (await prisma.clientApprovalRequest.create({
      data: { organizationId: orgId, clientId: client.id, projectId: project.id, title: "Approve scope", requestedByUserId: users.manager.id, dueAt: new Date("2026-10-28T12:00:00Z") },
    })).id;

    const event = (title: string, extra: Record<string, unknown>) =>
      prisma.calendarEvent.create({ data: { organizationId: orgId, title, startAt: new Date("2026-10-16T00:00:00Z"), allDay: true, createdByUserId: users.admin.id, ...extra } as never });
    ids.eventOrg = (await event("Org picnic", { visibility: "ORGANIZATION" })).id;
    ids.eventPrivate = (await event("Private dentist", { visibility: "PRIVATE", createdByUserId: users.outsider.id, assignedEmployeeId: ids.outsiderEmployee })).id;
    ids.eventProject = (await event("Project kickoff", { visibility: "PROJECT", projectId: project.id, createdByUserId: users.manager.id })).id;
    ids.eventTimed = (await event("Late call", { visibility: "ORGANIZATION", allDay: false, startAt: new Date("2026-10-17T01:00:00Z"), endAt: new Date("2026-10-17T02:00:00Z") })).id;
    ids.eventAdminPrivate = (await event("Admin private", { visibility: "PRIVATE" })).id;
  });

  after(async () => {
    await prisma?.$disconnect();
  });

  // ------------------------------------------------------------------ calendar

  test("aggregates every source for an administrator", async () => {
    const items = await itemKeys(users.admin);
    for (const key of [
      `project:${ids.project}:start`, `project:${ids.project}:target`, `task:${ids.taskOverdue}:due`, `task:${ids.taskSoon}:due`,
      `qualification:${ids.qualOwn}`, `rental:${ids.rental}:reservation`, `rental:${ids.rental}:checkout`,
      `invoice:${ids.invoiceSoon}:due`, `signature:${ids.signature}:expires`, `approval:${ids.approval}`,
      `event:${ids.eventOrg}`, `event:${ids.eventTimed}`,
    ]) assert.ok(findKey(items, key), `missing ${key}`);
    assert.ok(items.some((item) => item.type === "MILESTONE"));
    assert.ok(!findKey(items, `event:${ids.eventPrivate}`), "admins must not see other people's private events");
    assert.ok(findKey(items, `event:${ids.eventAdminPrivate}`));
  });

  test("date-only values never shift with time zone, instants do", async () => {
    for (const zone of ["Pacific/Honolulu", "Asia/Tokyo", "UTC"]) {
      const items = await itemKeys(users.admin, {}, zone);
      assert.equal(findKey(items, `qualification:${ids.qualOwn}`)?.startKey, "2026-10-25", zone);
      assert.equal(findKey(items, `task:${ids.taskSoon}:due`)?.startKey, "2026-10-20", zone);
      assert.equal(findKey(items, `event:${ids.eventOrg}`)?.startKey, "2026-10-16", zone);
    }
    // 2026-10-27T03:00Z is still the 26th in New York but the 27th in UTC.
    assert.equal(findKey(await itemKeys(users.admin, {}, "America/New_York"), `signature:${ids.signature}:expires`)?.startKey, "2026-10-26");
    assert.equal(findKey(await itemKeys(users.admin, {}, "UTC"), `signature:${ids.signature}:expires`)?.startKey, "2026-10-27");
    assert.equal(findKey(await itemKeys(users.admin, {}, "America/New_York"), `event:${ids.eventTimed}`)?.startKey, "2026-10-16");
  });

  test("an employee only sees records they are authorized to open", async () => {
    const items = await itemKeys(users.employee);
    assert.ok(findKey(items, `task:${ids.taskOverdue}:due`));
    assert.ok(!findKey(items, `task:${ids.taskOther}:due`), "someone else's standalone task");
    assert.ok(findKey(items, `qualification:${ids.qualOwn}`));
    assert.ok(!findKey(items, `qualification:${ids.qualOther}`), "another employee's credential");
    assert.ok(!items.some((item) => item.type === "INVOICE"), "financial dates are hidden from employees");
    assert.ok(!items.some((item) => item.type === "APPROVAL"));
    assert.ok(findKey(items, `signature:${ids.signature}:expires`), "signature tied to my project");
    assert.ok(findKey(items, `event:${ids.eventProject}`), "project-visible event for a member");
    assert.ok(!findKey(items, `event:${ids.eventPrivate}`));
  });

  test("a non-member sees neither the project nor its events, but sees organization events", async () => {
    const items = await itemKeys(users.outsider);
    assert.ok(!items.some((item) => item.type === "PROJECT" || item.type === "MILESTONE"));
    assert.ok(!findKey(items, `event:${ids.eventProject}`));
    assert.ok(!findKey(items, `signature:${ids.signature}:expires`));
    assert.ok(findKey(items, `event:${ids.eventOrg}`));
    assert.ok(findKey(items, `event:${ids.eventPrivate}`), "own private event");
    assert.ok(findKey(items, `task:${ids.taskOther}:due`));
  });

  test("managers see invoices and approvals they own, not unrelated ones", async () => {
    const items = await itemKeys(users.manager);
    assert.ok(findKey(items, `invoice:${ids.invoiceSoon}:due`));
    assert.ok(findKey(items, `approval:${ids.approval}`));
    assert.equal(findKey(items, `invoice:${ids.invoiceLate}:due`)?.startKey, "2026-10-10");
    const late = items.find((item) => item.key === `invoice:${ids.invoiceLate}:due`);
    assert.equal(late?.overdue, true);
  });

  test("other organizations see nothing", async () => {
    assert.equal((await itemKeys(users.foreign)).length, 0);
  });

  test("filters narrow results and unsupported combinations return nothing", async () => {
    const onlyTasks = await itemKeys(users.admin, { types: ["TASK"] });
    assert.ok(onlyTasks.length > 0 && onlyTasks.every((item) => item.type === "TASK"));
    const byProject = await itemKeys(users.admin, { projectId: ids.project });
    assert.ok(!findKey(byProject, `task:${ids.taskSoon}:due`), "standalone task is not on the project");
    assert.ok(findKey(byProject, `task:${ids.taskOverdue}:due`));
    const byEmployee = await itemKeys(users.admin, { employeeId: ids.employeeEmployee });
    assert.ok(findKey(byEmployee, `qualification:${ids.qualOwn}`));
    assert.ok(!findKey(byEmployee, `qualification:${ids.qualOther}`));
    assert.ok(!byEmployee.some((item) => item.type === "INVOICE"), "invoices have no employee");
    const mine = await itemKeys(users.employee, { mine: true });
    assert.ok(mine.every((item) => item.type !== "INVOICE"));
    assert.ok(findKey(mine, `task:${ids.taskSoon}:due`));
    const byClient = await itemKeys(users.admin, { clientId: ids.client });
    assert.ok(findKey(byClient, `invoice:${ids.invoiceSoon}:due`));
    assert.ok(!findKey(byClient, `qualification:${ids.qualOwn}`));
    const completedHidden = await itemKeys(users.admin, { types: ["TASK"] });
    await prisma.task.update({ where: { id: ids.taskSoon }, data: { status: "COMPLETED" } });
    assert.ok(!findKey(await itemKeys(users.admin, { types: ["TASK"] }), `task:${ids.taskSoon}:due`));
    assert.ok(findKey(await itemKeys(users.admin, { types: ["TASK"], showCompleted: true }), `task:${ids.taskSoon}:due`));
    await prisma.task.update({ where: { id: ids.taskSoon }, data: { status: "TODO" } });
    assert.ok(completedHidden.length > 0);
  });

  // ------------------------------------------------------------ notifications

  const notificationsFor = (user: AuthUser) => prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });

  test("scheduled job produces the expected reminders once", async () => {
    const first = await jobs.runNotificationJobs({ now: NOW, organizationId: orgId });
    const mine = await notificationsFor(users.employee);
    const types = mine.map((n) => n.type).sort();
    assert.deepEqual(types, ["QUALIFICATION_EXPIRED", "QUALIFICATION_EXPIRING", "TASK_DUE_SOON", "TASK_DUE_TOMORROW", "TASK_OVERDUE"].sort());
    const manager = (await notificationsFor(users.manager)).map((n) => n.type).sort();
    assert.deepEqual(manager, ["INVOICE_DUE_SOON", "INVOICE_OVERDUE", "RENTAL_OVERDUE"]);
    assert.ok((first.created.TASK_OVERDUE ?? 0) >= 1);
    // Employees never receive financial notifications; links are server generated.
    assert.ok(mine.every((n) => n.category !== "INVOICES"));
    assert.ok(mine.find((n) => n.type === "TASK_OVERDUE")?.actionUrl === `/tasks/${ids.taskOverdue}`);

    // Idempotency: re-running (even many times) creates nothing new.
    const before = await prisma.notification.count({ where: { organizationId: orgId } });
    const again = await jobs.runNotificationJobs({ now: NOW, organizationId: orgId });
    await jobs.runNotificationJobs({ now: new Date(NOW.getTime() + 3600_000), organizationId: orgId });
    assert.equal(Object.values(again.created).reduce((a, b) => a + b, 0), 0);
    assert.equal(await prisma.notification.count({ where: { organizationId: orgId } }), before);
  });

  test("qualification reminders step down tiers over time, once each", async () => {
    const count = () => prisma.notification.count({ where: { userId: users.employee.id, type: "QUALIFICATION_EXPIRING" } });
    assert.equal(await count(), 1); // 10 days out -> 30-day tier
    await jobs.runNotificationJobs({ now: new Date("2026-10-17T15:00:00Z"), organizationId: orgId }); // 8 days: same tier
    assert.equal(await count(), 1);
    await jobs.runNotificationJobs({ now: new Date("2026-10-18T15:00:00Z"), organizationId: orgId }); // 7 days: 7-day tier
    assert.equal(await count(), 2);
    await jobs.runNotificationJobs({ now: new Date("2026-10-19T15:00:00Z"), organizationId: orgId });
    assert.equal(await count(), 2);
  });

  test("changing a due date starts a new reminder cycle; reading never alters the task", async () => {
    const overdue = await prisma.notification.findFirstOrThrow({ where: { userId: users.employee.id, type: "TASK_OVERDUE", relatedEntityId: ids.taskOverdue } });
    await svc.markRead(users.employee, overdue.id);
    assert.ok((await prisma.notification.findUniqueOrThrow({ where: { id: overdue.id } })).readAt);
    const task = await prisma.task.findUniqueOrThrow({ where: { id: ids.taskOverdue } });
    assert.equal(task.status, "TODO");
    assert.equal(task.dueDate?.toISOString(), "2026-10-14T12:00:00.000Z");
    // Overdue notifications can be read but not dismissed.
    assert.equal(await svc.dismiss(users.employee, overdue.id), false);
    const soon = await prisma.notification.findFirstOrThrow({ where: { userId: users.employee.id, type: "TASK_DUE_SOON" } });
    assert.equal(await svc.dismiss(users.employee, soon.id), true);
    assert.ok((await prisma.notification.findUniqueOrThrow({ where: { id: soon.id } })).dismissedAt);
    // A dismissed notification is not recreated by the next run.
    await jobs.runNotificationJobs({ now: NOW, organizationId: orgId });
    assert.equal(await prisma.notification.count({ where: { userId: users.employee.id, type: "TASK_DUE_SOON" } }), 1);
    // Moving the due date changes the key, so the new date gets its own reminder.
    await prisma.task.update({ where: { id: ids.taskSoon }, data: { dueDate: new Date("2026-10-19T12:00:00Z") } });
    await jobs.runNotificationJobs({ now: NOW, organizationId: orgId });
    assert.equal(await prisma.notification.count({ where: { userId: users.employee.id, type: "TASK_DUE_SOON" } }), 2);
  });

  test("preferences suppress a category without touching others", async () => {
    await svc.setInAppPreference(users.outsider, "TASK_REMINDERS", false);
    const fresh = await prisma.task.create({
      data: { organizationId: orgId, title: "Fresh", dueDate: new Date("2026-10-19T12:00:00Z"), assignedToEmployeeId: ids.outsiderEmployee, createdByUserId: users.admin.id },
    });
    await jobs.runNotificationJobs({ now: NOW, organizationId: orgId });
    const mine = await notificationsFor(users.outsider);
    assert.ok(!mine.some((n) => n.relatedEntityId === fresh.id), "disabled category is not delivered");
    await events.notifyTaskAssigned({ organizationId: orgId, taskId: ids.taskOther, actorUserId: users.admin.id });
    assert.ok((await notificationsFor(users.outsider)).some((n) => n.type === "TASK_ASSIGNED"), "other categories still delivered");
    const lookup = await svc.getPreferences(users.outsider);
    assert.equal(lookup("TASK_REMINDERS", "IN_APP"), false);
    assert.equal(lookup("RENTALS", "IN_APP"), true);
    assert.equal(lookup("RENTALS", "EMAIL"), false);
  });

  test("immediate events notify the right people and never the actor", async () => {
    const countFor = (user: AuthUser, type: string) => prisma.notification.count({ where: { userId: user.id, type: type as never } });
    await events.notifyTaskAssigned({ organizationId: orgId, taskId: ids.taskTomorrow, actorUserId: users.employee.id }); // self-assignment
    assert.equal(await countFor(users.employee, "TASK_ASSIGNED"), 0);
    await events.notifyTaskAssigned({ organizationId: orgId, taskId: ids.taskTomorrow, actorUserId: users.manager.id });
    assert.equal(await countFor(users.employee, "TASK_ASSIGNED"), 1);

    await events.notifyProjectMemberAdded({ organizationId: orgId, projectId: ids.project, employeeId: ids.employeeEmployee, actorUserId: users.manager.id });
    assert.equal(await countFor(users.employee, "PROJECT_MEMBER_ADDED"), 1);

    await events.notifySignatureRequested({ organizationId: orgId, signatureRequestId: ids.signature, actorUserId: users.manager.id });
    await events.notifySignatureRequested({ organizationId: orgId, signatureRequestId: ids.signature, actorUserId: users.manager.id });
    assert.equal(await countFor(users.employee, "SIGNATURE_REQUESTED"), 1, "signature notification is idempotent");

    await events.notifyApprovalRequested({ organizationId: orgId, approvalId: ids.approval, actorUserId: users.admin.id });
    assert.equal(await countFor(users.manager, "APPROVAL_REQUESTED"), 1);

    await events.notifyClientResponseReceived({ organizationId: orgId, approvalId: ids.approval });
    assert.equal(await countFor(users.manager, "CLIENT_RESPONSE_RECEIVED"), 0, "still pending: nothing to report");
    await prisma.clientApprovalRequest.update({ where: { id: ids.approval }, data: { status: "APPROVED", respondedAt: NOW } });
    await events.notifyClientResponseReceived({ organizationId: orgId, approvalId: ids.approval });
    assert.equal(await countFor(users.manager, "CLIENT_RESPONSE_RECEIVED"), 1);
    await prisma.clientApprovalRequest.update({ where: { id: ids.approval }, data: { status: "PENDING", respondedAt: null } });

    await events.notifyDocumentShared({ organizationId: orgId, documentId: ids.document, actorUserId: users.manager.id });
    assert.equal(await countFor(users.employee, "DOCUMENT_SHARED"), 1, "project member can open the document");
    assert.equal(await countFor(users.outsider, "DOCUMENT_SHARED"), 0, "non-member cannot");
  });

  test("lists are organization- and user-scoped, paginated, and links are safe", async () => {
    await prisma.notification.createMany({
      data: Array.from({ length: 60 }, (_, index) => ({
        organizationId: orgId, userId: users.manager.id, type: "PROJECT_MEMBER_ADDED" as const, category: "PROJECT_UPDATES" as const,
        title: `Bulk ${index}`, message: "m", createdAt: new Date(NOW.getTime() - index * 1000),
      })),
    });
    const pageOne = await svc.listNotifications(users.manager, "all", 1);
    const pageThree = await svc.listNotifications(users.manager, "all", 3);
    assert.equal(pageOne.items.length, 25);
    assert.ok(pageOne.pages >= 3);
    assert.ok(pageThree.items.length > 0 && pageThree.items.length <= 25);
    assert.notEqual(pageOne.items[0].id, pageThree.items[0].id);

    // Another user (same org) and another organization cannot touch or open these.
    const target = pageOne.items[0];
    assert.equal(await svc.markRead(users.employee, target.id), 0);
    assert.equal(await svc.markRead(users.foreign, target.id), 0);
    assert.equal(await svc.dismiss(users.foreign, target.id), false);
    assert.equal(await svc.getOpenTarget(users.foreign, target.id), null);
    assert.equal((await svc.listNotifications(users.foreign, "all", 1)).total, 0);

    // A tampered stored URL is never followed.
    const bad = await prisma.notification.create({ data: { organizationId: orgId, userId: users.manager.id, type: "TASK_ASSIGNED", category: "TASK_ASSIGNMENTS", title: "x", message: "x", actionUrl: "https://evil.example" } });
    assert.equal(await svc.getOpenTarget(users.manager, bad.id), null);
    const good = await prisma.notification.findFirstOrThrow({ where: { userId: users.employee.id, type: "TASK_OVERDUE", relatedEntityId: ids.taskOverdue } });
    assert.equal(await svc.getOpenTarget(users.employee, good.id), `/tasks/${ids.taskOverdue}`);

    const unreadBefore = await svc.unreadCount(users.manager);
    assert.ok(unreadBefore > 60);
    await svc.markAllRead(users.manager);
    assert.equal(await svc.unreadCount(users.manager), 0);
    assert.ok((await svc.listNotifications(users.manager, "all", 1)).total > 60, "read items remain listed under All");
  });

  test("archiving hides old read notifications but keeps idempotency keys", async () => {
    const keyed = await prisma.notification.findFirstOrThrow({ where: { userId: users.employee.id, type: "TASK_OVERDUE", relatedEntityId: ids.taskOverdue } });
    await prisma.notification.update({ where: { id: keyed.id }, data: { createdAt: new Date("2026-01-01T00:00:00Z"), readAt: NOW } });
    const archived = await svc.archiveOldNotifications(orgId, 90, NOW);
    assert.ok(archived >= 1);
    assert.equal((await svc.listNotifications(users.employee, "all", 1)).items.some((n) => n.id === keyed.id), false);
    const before = await prisma.notification.count({ where: { userId: users.employee.id } });
    await jobs.runNotificationJobs({ now: NOW, organizationId: orgId });
    assert.equal(await prisma.notification.count({ where: { userId: users.employee.id } }), before, "archived reminder is not re-sent");
  });

  test("source authorization still applies after a notification link is followed", async () => {
    // The link target is a normal page that applies its own policy; verify the policy the page uses.
    const { taskVisibilityWhere } = await import("@/modules/tasks/authorization");
    const visible = (user: AuthUser) => prisma.task.findFirst({ where: { id: ids.taskOther, ...taskVisibilityWhere(user) } });
    assert.ok(await visible(users.outsider));
    assert.equal(await visible(users.employee), null);
    assert.equal(await visible(users.foreign), null);
  });
});
