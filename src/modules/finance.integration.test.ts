/**
 * Ledger, reporting and audit checks against a real PostgreSQL.
 * Opt-in (writes data): INTEGRATION_TESTS=1 DATABASE_URL=... npm run test:integration
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
type AuthUser = import("@/lib/auth/session").AuthenticatedUser;

describe("ledger, reports and audit (database)", { skip: !enabled }, () => {
  let prisma: typeof import("@/lib/prisma").prisma;
  let ledger: typeof import("@/modules/ledger/service");
  let ledgerData: typeof import("@/modules/ledger/data");
  let ledgerAuth: typeof import("@/modules/ledger/authorization");
  let auditSvc: typeof import("@/modules/audit/service");
  let auditData: typeof import("@/modules/audit/data");
  let reports: typeof import("@/modules/reports/run");
  let registry: typeof import("@/modules/reports/registry");
  let exporter: typeof import("@/modules/reports/export");
  let money: typeof import("@/modules/ledger/money");

  const sfx = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  const users = {} as Record<"admin" | "manager" | "otherManager" | "employee" | "foreign", AuthUser>;
  let orgId = "", foreignOrgId = "";

  const run = async (user: AuthUser, id: string, params: Record<string, string> = {}, options: { export?: boolean } = {}) => {
    const prepared = await reports.prepareReport(user, id, params, { now: NOW, zone: "America/New_York", ...options });
    return prepared ? reports.runPrepared(prepared) : null;
  };
  const col = (result: NonNullable<Awaited<ReturnType<typeof run>>>, label: string) => result.columns.findIndex((c) => c.label === label);

  before(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    ledger = await import("@/modules/ledger/service");
    ledgerData = await import("@/modules/ledger/data");
    ledgerAuth = await import("@/modules/ledger/authorization");
    auditSvc = await import("@/modules/audit/service");
    auditData = await import("@/modules/audit/data");
    reports = await import("@/modules/reports/run");
    registry = await import("@/modules/reports/registry");
    exporter = await import("@/modules/reports/export");
    money = await import("@/modules/ledger/money");

    const org = await prisma.organization.create({ data: { name: `Fin org ${sfx}`, timezone: "America/New_York" } });
    const other = await prisma.organization.create({ data: { name: `Fin other ${sfx}` } });
    orgId = org.id; foreignOrgId = other.id;
    const mk = async (key: keyof typeof users, role: "ADMIN" | "MANAGER" | "EMPLOYEE", organizationId = org.id) => {
      const department = key === "employee" ? (ids.dept ??= (await prisma.department.create({ data: { organizationId, name: `Dept ${sfx}` } })).id) : null;
      const employee = await prisma.employee.create({ data: { organizationId, firstName: key, lastName: sfx, departmentId: department } });
      const user = await prisma.user.create({ data: { organizationId, employeeId: employee.id, email: `${key}-${sfx}@fin.local`, passwordHash: "x", role } });
      ids[`${key}Employee`] = employee.id;
      users[key] = { id: user.id, organizationId, employeeId: employee.id, email: user.email, role, displayName: key };
    };
    await mk("admin", "ADMIN"); await mk("manager", "MANAGER"); await mk("otherManager", "MANAGER"); await mk("employee", "EMPLOYEE"); await mk("foreign", "ADMIN", other.id);

    const client = await prisma.client.create({ data: { organizationId: orgId, name: `Client ${sfx}`, createdByUserId: users.admin.id } });
    const project = await prisma.project.create({ data: { organizationId: orgId, name: `Project ${sfx}`, clientId: client.id, projectManagerId: ids.managerEmployee, status: "ACTIVE", startDate: new Date("2026-09-01T00:00:00Z"), targetEndDate: new Date("2026-12-01T00:00:00Z"), members: { create: { organizationId: orgId, employeeId: ids.employeeEmployee } } } });
    const otherProject = await prisma.project.create({ data: { organizationId: orgId, name: `Other project ${sfx}`, clientId: client.id, projectManagerId: ids.otherManagerEmployee, status: "PLANNING" } });
    Object.assign(ids, { client: client.id, project: project.id, otherProject: otherProject.id });

    const invoice = (number: string, due: string, balance: string, createdBy: string, projectId: string | null) =>
      prisma.invoice.create({ data: { organizationId: orgId, invoiceNumber: number, clientId: client.id, projectId, status: "SENT", dueDate: new Date(`${due}T12:00:00Z`), total: balance, balanceDue: balance, currency: "USD", createdByUserId: createdBy } });
    ids.invCurrent = (await invoice(`I1-${sfx}`, "2026-10-20", "100.10", users.manager.id, project.id)).id;
    ids.inv10 = (await invoice(`I2-${sfx}`, "2026-10-05", "200.20", users.manager.id, project.id)).id;
    ids.inv45 = (await invoice(`I3-${sfx}`, "2026-08-30", "300.30", users.manager.id, project.id)).id;
    ids.inv200 = (await invoice(`I4-${sfx}`, "2026-03-01", "400.40", users.admin.id, null)).id;
    await prisma.invoice.create({ data: { organizationId: orgId, invoiceNumber: `D-${sfx}`, clientId: client.id, status: "DRAFT", balanceDue: "999.00", total: "999.00", createdByUserId: users.admin.id } });

    ids.task = (await prisma.task.create({ data: { organizationId: orgId, title: "=Overdue formula task", dueDate: new Date("2026-10-01T12:00:00Z"), assignedToEmployeeId: ids.employeeEmployee, projectId: project.id, createdByUserId: users.admin.id } })).id;
    await prisma.task.create({ data: { organizationId: orgId, title: "Done task", status: "COMPLETED", completedAt: new Date("2026-10-10T16:00:00Z"), dueDate: new Date("2026-10-09T12:00:00Z"), assignedToEmployeeId: ids.employeeEmployee, projectId: project.id, createdByUserId: users.admin.id } });
    await prisma.task.create({ data: { organizationId: orgId, title: "Hidden from employee", dueDate: new Date("2026-10-01T12:00:00Z"), assignedToEmployeeId: ids.managerEmployee, createdByUserId: users.admin.id } });

    const type = await prisma.qualificationType.create({ data: { organizationId: orgId, name: `Cert ${sfx}`, category: "CERTIFICATION" } });
    const position = await prisma.position.create({ data: { organizationId: orgId, title: `Pos ${sfx}` } });
    await prisma.positionQualificationRequirement.create({ data: { organizationId: orgId, positionId: position.id, qualificationTypeId: type.id, required: true } });
    await prisma.employee.update({ where: { id: ids.employeeEmployee }, data: { positionId: position.id } });
    ids.qualType = type.id; ids.position = position.id;

    const equipment = await prisma.equipment.create({ data: { organizationId: orgId, assetNumber: `A-${sfx}`, name: "Generator" } });
    ids.equipment = equipment.id;
    const rental = await prisma.rental.create({ data: { organizationId: orgId, rentalNumber: `R-${sfx}`, clientId: client.id, status: "CHECKED_OUT", reservationStart: new Date("2026-10-01T00:00:00Z"), reservationEnd: new Date("2026-10-10T00:00:00Z"), checkedOutAt: new Date("2026-10-01T00:00:00Z"), createdByUserId: users.admin.id, items: { create: { equipmentId: equipment.id, checkedOutAt: new Date("2026-10-01T00:00:00Z") } } } });
    ids.rental = rental.id;
  });

  after(async () => { await prisma?.$disconnect(); });

  // ------------------------------------------------------------------ ledger

  test("records income, expense, linked and standalone transactions with exact amounts", async () => {
    const make = (type: "INCOME" | "EXPENSE" | "ADJUSTMENT", amount: string, extra: Record<string, unknown> = {}) =>
      prisma.$transaction((tx) => ledger.createLedgerTransaction(tx, orgId, users.admin, users.admin.id, { type, transactionDate: new Date("2026-10-05T00:00:00Z"), description: `${type} ${amount}`, amount: money.parseMoney(amount)!, ...extra } as never));
    const income = await make("INCOME", "1500.50", { projectId: ids.project, clientId: ids.client });
    const expense = await make("EXPENSE", "250.25", { projectId: ids.project, equipmentId: ids.equipment });
    const standalone = await make("EXPENSE", "10.00");
    const adjustment = await make("ADJUSTMENT", "-5.05");
    assert.equal(income.projectId, ids.project);
    assert.equal(income.clientId, ids.client);
    assert.equal(standalone.projectId, null);
    assert.match(income.transactionNumber!, /^LT-\d{6}$/);
    assert.notEqual(income.transactionNumber, expense.transactionNumber);
    assert.equal(adjustment.amount.toFixed(2), "-5.05");
    const summary = await ledgerData.ledgerSummary(users.admin, {});
    assert.deepEqual(summary.map((s) => [s.currency, s.income, s.expense, s.adjustments, s.net]), [["USD", "1500.50", "260.25", "-5.05", "1235.20"]]);
    // A negative expense is rejected by the database as well as by validation.
    await assert.rejects(() => prisma.ledgerTransaction.create({ data: { organizationId: orgId, type: "EXPENSE", transactionDate: new Date("2026-10-05T00:00:00Z"), description: "bad", amount: "-1.00", createdByUserId: users.admin.id } }));
    await assert.rejects(() => prisma.ledgerTransaction.create({ data: { organizationId: orgId, type: "ADJUSTMENT", transactionDate: new Date("2026-10-05T00:00:00Z"), description: "zero", amount: "0.00", createdByUserId: users.admin.id } }));
  });

  test("decimal sums stay exact over many small amounts", async () => {
    for (let i = 0; i < 30; i += 1) {
      await prisma.$transaction((tx) => ledger.createLedgerTransaction(tx, orgId, users.admin, users.admin.id, { type: "INCOME", transactionDate: new Date("2026-02-01T00:00:00Z"), description: "dime", amount: money.parseMoney("0.10")! }));
    }
    const feb = await ledgerData.ledgerSummary(users.admin, { from: "2026-02-01", to: "2026-02-28" });
    assert.equal(feb[0].income, "3.00");
    assert.equal(feb[0].net, "3.00");
  });

  test("payments post to the ledger once, idempotently, and are voided with the payment", async () => {
    const payment = await prisma.payment.create({ data: { organizationId: orgId, invoiceId: ids.inv10, amount: "200.20", paymentDate: new Date("2026-10-06T12:00:00Z"), method: "CHECK", recordedByUserId: users.manager.id } });
    const first = await prisma.$transaction((tx) => ledger.postPaymentToLedger(tx, orgId, payment.id, users.manager));
    const again = await prisma.$transaction((tx) => ledger.postPaymentToLedger(tx, orgId, payment.id, users.manager));
    await Promise.all([1, 2, 3].map(() => prisma.$transaction((tx) => ledger.postPaymentToLedger(tx, orgId, payment.id, users.manager)).catch(() => null)));
    assert.ok(first);
    assert.equal(again?.id ?? first!.id, first!.id);
    assert.equal(await prisma.ledgerTransaction.count({ where: { paymentId: payment.id } }), 1);
    assert.equal(first!.type, "INCOME");
    assert.equal(first!.amount.toFixed(2), "200.20");
    assert.equal(first!.invoiceId, ids.inv10);
    assert.equal(first!.projectId, ids.project);

    // Payment-linked entries cannot be voided directly...
    await assert.rejects(() => prisma.$transaction((tx) => ledger.voidLedgerTransaction(tx, orgId, users.admin, first!.id, "oops")), /Correct the payment/);
    // ...they are voided when the payment is corrected.
    await prisma.payment.update({ where: { id: payment.id }, data: { correctedAt: NOW, correctionReason: "typo" } });
    await prisma.$transaction((tx) => ledger.voidLedgerForPayment(tx, orgId, users.admin, payment.id, "typo"));
    const voided = await prisma.ledgerTransaction.findUniqueOrThrow({ where: { id: first!.id } });
    assert.ok(voided.voidedAt);
    assert.equal(voided.voidedByUserId, users.admin.id);
    assert.match(voided.voidReason!, /typo/);
    assert.equal(voided.amount.toFixed(2), "200.20", "original amount is preserved");
    // A corrected payment is never (re)posted.
    assert.equal(await prisma.$transaction((tx) => ledger.postPaymentToLedger(tx, orgId, payment.id, users.admin)), null);

    // Posting can be disabled per organization.
    await prisma.organization.update({ where: { id: orgId }, data: { autoPostPaymentsToLedger: false } });
    const quiet = await prisma.payment.create({ data: { organizationId: orgId, invoiceId: ids.inv45, amount: "5.00", paymentDate: new Date("2026-10-07T12:00:00Z"), method: "CASH", recordedByUserId: users.admin.id } });
    assert.equal(await prisma.$transaction((tx) => ledger.postPaymentToLedger(tx, orgId, quiet.id, users.admin)), null);
    await prisma.organization.update({ where: { id: orgId }, data: { autoPostPaymentsToLedger: true } });
    // Backfill style call now posts it exactly once.
    assert.ok(await prisma.$transaction((tx) => ledger.postPaymentToLedger(tx, orgId, quiet.id, users.admin)));
    assert.equal(await prisma.ledgerTransaction.count({ where: { paymentId: quiet.id } }), 1);
    ids.payment = quiet.id;
  });

  test("voiding keeps the record, excludes it from totals, and cannot be repeated", async () => {
    const row = await prisma.$transaction((tx) => ledger.createLedgerTransaction(tx, orgId, users.admin, users.admin.id, { type: "EXPENSE", transactionDate: new Date("2026-04-01T00:00:00Z"), description: "to void", amount: money.parseMoney("40.00")! }));
    const before = (await ledgerData.ledgerSummary(users.admin, { from: "2026-04-01", to: "2026-04-30" }))[0];
    assert.equal(before.expense, "40.00");
    await prisma.$transaction((tx) => ledger.voidLedgerTransaction(tx, orgId, users.admin, row.id, "entered twice"));
    const after = await ledgerData.ledgerSummary(users.admin, { from: "2026-04-01", to: "2026-04-30" });
    assert.equal(after.length, 0);
    const stored = await prisma.ledgerTransaction.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.description, "to void");
    assert.equal(stored.voidReason, "entered twice");
    await assert.rejects(() => prisma.$transaction((tx) => ledger.voidLedgerTransaction(tx, orgId, users.admin, row.id, "again")), /already void/);
    const listed = await ledgerData.listLedger(users.admin, { includeVoided: true, page: 1, from: "2026-04-01", to: "2026-04-30" });
    assert.equal(listed.rows.length, 1);
  });

  test("financial authorization: employees nothing, managers only their own scope", async () => {
    assert.equal(ledgerAuth.canAccessLedger(users.employee), false);
    assert.equal((await ledgerData.listLedger(users.employee, { includeVoided: false, page: 1 })).total, 0);
    const managerView = await ledgerData.listLedger(users.manager, { includeVoided: false, page: 1 });
    const adminView = await ledgerData.listLedger(users.admin, { includeVoided: false, page: 1 });
    assert.ok(managerView.total > 0 && managerView.total < adminView.total, "manager sees a strict subset");
    assert.ok(managerView.rows.every((r) => r.projectId === ids.project || r.invoiceId !== null));
    assert.equal((await ledgerData.listLedger(users.otherManager, { includeVoided: false, page: 1 })).total, 0);
    assert.equal((await ledgerData.listLedger(users.foreign, { includeVoided: false, page: 1 })).total, 0);
    assert.equal(ledgerAuth.canCreateLedgerTransaction(users.manager, { projectManagerId: ids.managerEmployee }), true);
    assert.equal(ledgerAuth.canCreateLedgerTransaction(users.manager, { projectManagerId: ids.otherManagerEmployee }), false);
    assert.equal(ledgerAuth.canCreateLedgerTransaction(users.manager, null), false);
    assert.equal(ledgerAuth.canVoidLedgerTransaction(users.manager), false);
    assert.equal(ledgerAuth.canCreateLedgerTransaction(users.admin, null), true);
  });

  // ------------------------------------------------------------------ reports

  test("every report runs for an administrator and respects its access rule", async () => {
    for (const report of registry.ALL_REPORTS) {
      const result = await run(users.admin, report.id);
      assert.ok(result, `${report.id} should be available to admin`);
      assert.ok(result!.columns.length > 0);
      assert.ok(result!.rows.every((row) => row.length === result!.columns.length), `${report.id} row width`);
    }
    for (const id of ["employee-directory", "headcount", "qualification-status", "invoice-aging", "outstanding-invoices", "payments-received", "ledger-activity", "income-expense-summary", "outstanding-invoices-by-client", "audit-activity-summary"]) {
      assert.equal(await run(users.employee, id), null, `employee must not run ${id}`);
    }
    assert.equal(await run(users.manager, "audit-activity-summary"), null, "audit summary is admin-only");
    assert.ok(await run(users.employee, "open-tasks"));
    assert.equal(registry.reportsFor(users.employee).some((c) => c.reports.some((r) => r.id === "invoice-aging")), false);
    assert.equal(await run(users.admin, "does-not-exist"), null);
  });

  test("people and qualification reports", async () => {
    const directory = (await run(users.admin, "employee-directory"))!;
    assert.ok(directory.total >= 4);
    const byDept = (await run(users.admin, "employee-directory", { department: ids.dept }))!;
    assert.equal(byDept.total, 1);
    assert.equal(byDept.rows[0][col(byDept, "Department")], `Dept ${sfx}`);
    const headcount = (await run(users.admin, "headcount"))!;
    assert.ok(headcount.rows.some((r) => r[0] === "Employment status" && Number(r[2]) >= 4));
    const missing = (await run(users.admin, "missing-required-qualifications", { position: ids.position }))!;
    assert.equal(missing.total, 1);
    assert.equal(missing.rows[0][3], `Cert ${sfx}`);
    await prisma.employeeQualification.create({ data: { organizationId: orgId, employeeId: ids.employeeEmployee, qualificationTypeId: ids.qualType, expirationDate: new Date("2026-10-25T00:00:00Z"), verificationStatus: "VERIFIED" } });
    assert.equal((await run(users.admin, "missing-required-qualifications", { position: ids.position }))!.total, 0);
    const status = (await run(users.admin, "qualification-status", { status: "EXPIRING_SOON", qualificationType: ids.qualType }))!;
    assert.equal(status.total, 1);
    assert.equal(status.rows[0][col(status, "Status")], "expiring soon");
    assert.equal((await run(users.admin, "qualification-status", { status: "EXPIRED", qualificationType: ids.qualType }))!.total, 0);
    const expiring = (await run(users.admin, "expiring-qualifications", { days: "5", qualificationType: ids.qualType }))!;
    assert.equal(expiring.total, 0);
    assert.equal((await run(users.admin, "expiring-qualifications", { days: "30", qualificationType: ids.qualType }))!.total, 1);
  });

  test("project, task, client and rental reports", async () => {
    const projects = (await run(users.admin, "project-summary", { status: "ACTIVE" }))!;
    const row = projects.rows.find((r) => r[0] === `Project ${sfx}`)!;
    assert.ok(row);
    assert.equal(row[col(projects, "Team size")], 1);
    assert.ok(!projects.rows.some((r) => r[0] === `Other project ${sfx}`), "status filter");
    const employeeProjects = (await run(users.employee, "project-summary"))!;
    assert.ok(employeeProjects.rows.every((r) => r[0] !== `Other project ${sfx}`), "employee only sees their projects");
    const workload = (await run(users.admin, "project-workload", {}))!;
    const w = workload.rows.find((r) => r[0] === `Project ${sfx}`)!;
    assert.equal(w[col(workload, "Overdue tasks")], 1);
    assert.equal(w[col(workload, "Completed tasks")], 1);
    const overdue = (await run(users.admin, "overdue-tasks"))!;
    assert.ok(overdue.total >= 2);
    const employeeOverdue = (await run(users.employee, "overdue-tasks"))!;
    assert.ok(employeeOverdue.rows.every((r) => r[0] !== "Hidden from employee"), "task visibility applies");
    assert.equal(employeeOverdue.total, 1);
    const completed = (await run(users.admin, "completed-tasks", { from: "2026-10-01", to: "2026-10-31" }))!;
    assert.equal(completed.rows.filter((r) => r[0] === "Done task").length, 1);
    assert.equal(completed.rows.find((r) => r[0] === "Done task")![col(completed, "On time")], "Late");
    assert.equal((await run(users.admin, "completed-tasks", { from: "2026-01-01", to: "2026-01-31" }))!.rows.length, 0);
    const byAssignee = (await run(users.admin, "tasks-by-assignee", { from: "2026-10-01", to: "2026-10-31" }))!;
    assert.ok(byAssignee.rows.some((r) => String(r[0]).startsWith("employee")));
    const clients = (await run(users.admin, "client-directory"))!;
    assert.ok(clients.rows.some((r) => r[0] === `Client ${sfx}`));
    const activeByClient = (await run(users.admin, "active-projects-by-client"))!;
    assert.deepEqual(activeByClient.rows.find((r) => r[0] === `Client ${sfx}`)!.slice(1, 4), [1, 1, 0]);

    const inventory = (await run(users.employee, "equipment-inventory"))!;
    assert.ok(inventory.rows.some((r) => r[0] === `A-${sfx}`));
    const overdueRentals = (await run(users.admin, "overdue-rentals"))!;
    assert.equal(overdueRentals.rows.find((r) => r[0] === `R-${sfx}`)![col(overdueRentals, "Days overdue")], 6); // due Oct 9, 8pm New York time
    const rentalActivity = (await run(users.admin, "rental-activity", { from: "2026-10-01", to: "2026-10-31" }))!;
    assert.equal(rentalActivity.rows.find((r) => r[0] === `R-${sfx}`)![col(rentalActivity, "Items")], 1);
    const utilization = (await run(users.admin, "equipment-utilization", { from: "2026-10-01", to: "2026-10-10" }))!;
    const u = utilization.rows.find((r) => r[0] === `A-${sfx}`)!;
    assert.deepEqual([u[3], u[4], u[5]], [10, 10, "100.0%"]);
  });

  test("invoice aging, outstanding, payments and ledger reports use exact decimals", async () => {
    const aging = (await run(users.admin, "invoice-aging"))!;
    const bucket = (name: string) => aging.rows.find((r) => r[1] === name)!;
    // Today in New York is 2026-10-15: due 10-20 -> current; 10-05 -> 10 days; 08-30 -> 46 days; 03-01 -> 228 days.
    assert.deepEqual(bucket("Current (not yet due)").slice(2), [1, "100.10"]);
    assert.deepEqual(bucket("1–30 days overdue").slice(2), [1, "200.20"]);
    assert.deepEqual(bucket("31–60 days overdue").slice(2), [1, "300.30"]);
    assert.deepEqual(bucket("61–90 days overdue").slice(2), [0, "0.00"]);
    assert.deepEqual(bucket("Over 90 days overdue").slice(2), [1, "400.40"]);
    const managerAging = (await run(users.manager, "invoice-aging"))!;
    assert.deepEqual(managerAging.rows.find((r) => r[1] === "Over 90 days overdue")!.slice(2), [0, "0.00"], "manager cannot see the admin-created invoice");
    assert.equal((await run(users.foreign, "invoice-aging"))!.rows.length, 0);
    const outstanding = (await run(users.admin, "outstanding-invoices"))!;
    assert.equal(outstanding.total, 4, "drafts excluded");
    const clientTotals = (await run(users.admin, "outstanding-invoices-by-client"))!;
    const c = clientTotals.rows.find((r) => r[0] === `Client ${sfx}`)!;
    assert.deepEqual([c[2], c[3], c[4]], [4, "1001.00", "900.90"]);
    const payments = (await run(users.admin, "payments-received", { from: "2026-10-01", to: "2026-10-31" }))!;
    assert.equal(payments.total, 1, "the corrected payment is excluded");
    assert.equal(payments.summary![0].value, "5.00");
    const activity = (await run(users.admin, "ledger-activity", { from: "2026-10-01", to: "2026-10-31" }))!;
    const net = activity.summary!.find((s) => s.label.startsWith("Net"))!;
    assert.equal(net.value, "1240.20"); // 1500.50 + 5.00 payment - 260.25 - 5.05; the voided payment entry is excluded
    assert.ok(activity.rows.every((r) => r[col(activity, "Type")] !== undefined));
    const monthly = (await run(users.admin, "income-expense-summary", { from: "2026-02-01", to: "2026-10-31" }))!;
    const feb = monthly.rows.find((r) => r[0] === "2026-02")!;
    assert.deepEqual(feb.slice(2), ["3.00", "0.00", "0.00", "3.00"]);
    const filteredByProject = (await run(users.admin, "ledger-activity", { project: ids.project, from: "2026-10-01", to: "2026-10-31" }))!;
    assert.ok(filteredByProject.rows.every((r) => r[col(filteredByProject, "Project")] === `Project ${sfx}`));
    assert.equal((await run(users.otherManager, "ledger-activity", { from: "2026-01-01", to: "2026-12-31" }))!.total, 0);
  });

  test("exports reflect filters and permissions, and neutralize spreadsheet formulas", async () => {
    const result = (await run(users.admin, "overdue-tasks", {}, { export: true }))!;
    const csv = exporter.toCsv(result, { title: "Overdue tasks" });
    assert.ok(csv.includes("'=Overdue formula task"), "a task titled with a formula is neutralized");
    assert.ok(!/(^|,|\r\n)=Overdue/.test(csv));
    const scoped = (await run(users.employee, "overdue-tasks", {}, { export: true }))!;
    assert.ok(!exporter.toCsv(scoped, { title: "x" }).includes("Hidden from employee"));
    const filtered = (await run(users.admin, "overdue-tasks", { project: ids.project }, { export: true }))!;
    assert.equal(filtered.rows.length, 1);
    // A crafted parameter outside the report's declared filters is ignored, not honored.
    const crafted = (await run(users.employee, "overdue-tasks", { organizationId: foreignOrgId, project: "not-a-uuid" }, { export: true }))!;
    assert.equal(crafted.rows.length, scoped.rows.length);
  });

  test("saved filters are private, whitelisted JSON", async () => {
    const { parseReportFilters } = await import("@/modules/reports/filters");
    const def = registry.getReport("open-tasks")!;
    const parsed = parseReportFilters(def, { project: ids.project, status: "TODO", bogus: "1", client: "drop table" });
    assert.deepEqual(parsed, { project: ids.project, status: "TODO" });
    const row = await prisma.savedReportFilter.create({ data: { organizationId: orgId, userId: users.employee.id, reportId: "open-tasks", name: "mine", filters: parsed } });
    assert.equal(await prisma.savedReportFilter.count({ where: { id: row.id, userId: users.manager.id } }), 0);
  });

  // ------------------------------------------------------------------ audit

  test("audit events are written in the caller's transaction", async () => {
    const marker = `rollback-${sfx}`;
    await assert.rejects(() => prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id: ids.client }, data: { notes: marker } });
      await auditSvc.audit.record(tx, { organizationId: orgId, actor: auditSvc.userActor(users.admin), action: "client.updated", entityType: "Client", entityId: ids.client, summary: marker });
      throw new Error("business failure after audit");
    }), /business failure/);
    assert.equal(await prisma.auditEvent.count({ where: { organizationId: orgId, summary: marker } }), 0, "rolled back with the change");
    assert.notEqual((await prisma.client.findUniqueOrThrow({ where: { id: ids.client } })).notes, marker);

    await prisma.$transaction(async (tx) => {
      await tx.client.update({ where: { id: ids.client }, data: { notes: "committed" } });
      await auditSvc.audit.record(tx, { organizationId: orgId, actor: auditSvc.userActor(users.admin), action: "client.updated", entityType: "Client", entityId: ids.client, summary: `committed-${sfx}`, changes: [{ field: "notes", from: null, to: "x" }] });
    });
    assert.equal(await prisma.auditEvent.count({ where: { organizationId: orgId, summary: `committed-${sfx}` } }), 1);
  });

  test("ledger and payment operations are audited", async () => {
    const actions = (await prisma.auditEvent.findMany({ where: { organizationId: orgId, entityType: "LedgerTransaction" } })).map((e) => e.action);
    assert.ok(actions.includes("ledger.created"));
    assert.ok(actions.includes("ledger.voided"));
    const voided = await prisma.auditEvent.findFirstOrThrow({ where: { organizationId: orgId, action: "ledger.voided" } });
    assert.equal(voided.actorUserId, users.admin.id);
    assert.ok(voided.metadata && JSON.stringify(voided.metadata).includes("reason"));
  });

  test("secrets never reach audit metadata and actors are not conflated", async () => {
    const event = await auditSvc.audit.record(prisma, {
      organizationId: orgId, actor: auditSvc.userActor(users.admin), action: "auth.password.changed", entityType: "User", entityId: users.admin.id, summary: "Password changed",
      metadata: { password: "hunter2-super-secret", newPassword: "x", tokenHash: "deadbeef", apiKey: "k", nested: { sessionToken: "t", ok: "kept" }, role: "ADMIN" },
      changes: [{ field: "passwordHash", from: "old", to: "new" } as never, { field: "role", from: "A", to: "B" }],
    });
    const raw = JSON.stringify(event.metadata);
    for (const secret of ["hunter2", "deadbeef", "sessionToken", "apiKey"]) assert.ok(!raw.includes(secret), secret);
    assert.ok(raw.includes("kept"));
    await assert.rejects(() => auditSvc.audit.record(prisma, { organizationId: orgId, actor: { userId: users.admin.id, portalUserId: randomUUID() }, action: "portal.approval.submitted", entityType: "ClientApprovalRequest", summary: "x" }), /exactly one kind of actor/);
    const portal = await auditSvc.audit.record(prisma, { organizationId: orgId, actor: auditSvc.portalActor({ id: randomUUID(), email: "client@example.com" }), action: "portal.approval.submitted", entityType: "ClientApprovalRequest", summary: "approved" });
    assert.equal(portal.actorUserId, null);
    assert.ok(portal.actorPortalUserId);
    assert.match(portal.actorLabel!, /\(portal\)$/);
  });

  test("audit events are immutable at the database level", async () => {
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { organizationId: orgId } });
    await assert.rejects(() => prisma.auditEvent.update({ where: { id: event.id }, data: { summary: "tampered" } }), /immutable/);
    await assert.rejects(() => prisma.auditEvent.delete({ where: { id: event.id } }), /immutable/);
    await assert.rejects(() => prisma.auditEvent.deleteMany({ where: { organizationId: orgId } }), /immutable/);
    await assert.rejects(() => prisma.auditEvent.updateMany({ where: { organizationId: orgId }, data: { outcome: "FAILURE" } }), /immutable/);
    assert.equal((await prisma.auditEvent.findUniqueOrThrow({ where: { id: event.id } })).summary, event.summary);
  });

  test("audit listing filters, paginates and is organization-scoped", async () => {
    for (let i = 0; i < 60; i += 1) {
      await auditSvc.audit.record(prisma, { organizationId: orgId, actor: auditSvc.userActor(users.manager), action: "task.created", entityType: "Task", entityId: ids.task, summary: `bulk ${i} ${sfx}` });
    }
    const parse = auditData.parseAuditFilters;
    const page1 = await auditData.listAuditEvents(users.admin, parse({ q: `bulk` }), "UTC");
    const page2 = await auditData.listAuditEvents(users.admin, parse({ q: "bulk", page: "2" }), "UTC");
    assert.equal(page1.rows.length, 50);
    assert.equal(page2.rows.length, 10);
    assert.equal(page1.total, 60);
    assert.ok(page1.rows[0].occurredAt >= page1.rows[49].occurredAt, "newest first");
    assert.equal((await auditData.listAuditEvents(users.admin, parse({ action: "task", actor: "manager-" }), "UTC")).total, 60);
    assert.equal((await auditData.listAuditEvents(users.admin, parse({ action: "task.created", entityType: "Task", entityId: ids.task }), "UTC")).total, 60);
    assert.equal((await auditData.listAuditEvents(users.admin, parse({ action: "invoice" }), "UTC")).total, 0);
    const today = new Date().toISOString().slice(0, 10);
    assert.equal((await auditData.listAuditEvents(users.admin, parse({ from: today, to: today, q: "bulk" }), "UTC")).total, 60);
    assert.equal((await auditData.listAuditEvents(users.admin, parse({ from: "2020-01-01", to: "2020-01-02" }), "UTC")).total, 0);
    assert.equal((await auditData.listAuditEvents(users.foreign, parse({ q: "bulk" }), "UTC")).total, 0, "other organizations see nothing");
    // Unknown action/entity values from the URL are discarded rather than interpolated.
    assert.equal(parse({ action: "x'; drop table", entityType: "Nope" }).action, undefined);
    assert.equal(parse({ entityType: "Nope" }).entityType, undefined);
    // The audit-summary report is a second, admin-only view.
    const summary = (await run(users.admin, "audit-activity-summary", { from: today, to: today }))!;
    assert.ok(summary.rows.some((r) => r[0] === "task.created" && r[1] === 60));
  });
});
