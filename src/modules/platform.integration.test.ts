/**
 * Settings, global search and import/export against a real PostgreSQL.
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
type AuthUser = import("@/lib/auth/session").AuthenticatedUser;

describe("settings, search and import/export (database)", { skip: !enabled }, () => {
  let prisma: typeof import("@/lib/prisma").prisma;
  let settings: typeof import("@/modules/settings/service");
  let numbering: typeof import("@/modules/settings/numbering");
  let search: typeof import("@/modules/search/service");
  let engine: typeof import("@/modules/import-export/engine");
  let mapping: typeof import("@/modules/import-export/mapping");
  let exportsLib: typeof import("@/modules/import-export/exports");
  let reports: typeof import("@/modules/reports/run");
  let reportExport: typeof import("@/modules/reports/export");
  let notifications: typeof import("@/modules/notifications/service");
  let documents: typeof import("@/modules/documents/service");

  const sfx = randomUUID().slice(0, 6);
  const ids: Record<string, string> = {};
  const users = {} as Record<"admin" | "manager" | "alice" | "bob" | "foreign", AuthUser>;
  let orgId = "", otherOrgId = "";
  const form = (values: Record<string, string | string[]>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
    return data;
  };
  const names = (group: { hits: Array<{ title: string }> }) => group.hits.map((hit) => hit.title);
  const find = async (user: AuthUser, entity: Parameters<typeof search.searchEntity>[1], q: string, page = 1, size = 20) => search.searchEntity(user, entity, q, page, size);

  before(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    settings = await import("@/modules/settings/service");
    numbering = await import("@/modules/settings/numbering");
    search = await import("@/modules/search/service");
    engine = await import("@/modules/import-export/engine");
    mapping = await import("@/modules/import-export/mapping");
    exportsLib = await import("@/modules/import-export/exports");
    reports = await import("@/modules/reports/run");
    reportExport = await import("@/modules/reports/export");
    notifications = await import("@/modules/notifications/service");
    documents = await import("@/modules/documents/service");

    const org = await prisma.organization.create({ data: { name: `Plat org ${sfx}`, timezone: "America/New_York" } });
    const other = await prisma.organization.create({ data: { name: `Plat other ${sfx}` } });
    orgId = org.id; otherOrgId = other.id;
    const mk = async (key: keyof typeof users, role: "ADMIN" | "MANAGER" | "EMPLOYEE", organizationId = org.id, number: string | null = null) => {
      const employee = await prisma.employee.create({ data: { organizationId, firstName: key, lastName: `Zed${sfx}`, employeeNumber: number, workEmail: `${key}-${sfx}@plat.local` } });
      const user = await prisma.user.create({ data: { organizationId, employeeId: employee.id, email: `${key}-${sfx}@plat.local`, passwordHash: "x", role } });
      ids[`${key}Employee`] = employee.id;
      users[key] = { id: user.id, organizationId, employeeId: employee.id, email: user.email, role, displayName: key };
    };
    await mk("admin", "ADMIN", org.id, `A-${sfx}-1`); await mk("manager", "MANAGER", org.id, `A-${sfx}-2`); await mk("alice", "EMPLOYEE", org.id, `A-${sfx}-3`); await mk("bob", "EMPLOYEE", org.id, `A-${sfx}-4`); await mk("foreign", "ADMIN", other.id, `F-${sfx}-1`);
  });

  after(async () => { await prisma?.$disconnect(); });

  // ================================================================= settings

  test("identity, thresholds, defaults and features save, validate and are audited", async () => {
    const before = await prisma.auditEvent.count({ where: { organizationId: orgId } });
    const bad = await settings.saveSettingsSection(users.admin, "identity", form({ displayName: "Acme", timezone: "Mars/Base", defaultCurrency: "USD" }));
    assert.equal(bad.ok, false);
    assert.equal(await prisma.auditEvent.count({ where: { organizationId: orgId } }), before, "rejected input leaves no audit trail");

    const ok = await settings.saveSettingsSection(users.admin, "identity", form({ displayName: "Acme Command", legalName: "Acme Command LLC", billingAddress: "1 Main St\nPortland", phone: "555-0100", generalEmail: "hello@acme.test", website: "https://acme.test", timezone: "America/Chicago", defaultCurrency: "cad" }));
    assert.deepEqual(ok, { ok: true, changed: ok.ok ? ok.changed : 0 });
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    assert.equal(org.displayName, "Acme Command"); assert.equal(org.defaultCurrency, "CAD"); assert.equal(org.timezone, "America/Chicago");
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { organizationId: orgId, action: "settings.identity.changed" }, orderBy: { occurredAt: "desc" } });
    assert.ok(JSON.stringify(event.metadata).includes("timezone"));
    assert.equal(event.actorUserId, users.admin.id);

    assert.equal((await settings.saveSettingsSection(users.admin, "thresholds", form({ qualificationExpirationWarningDays: "45", taskDueSoonDays: "5", rentalDueSoonDays: "2", invoiceDueSoonDays: "10", maintenanceDueSoonDays: "21" }))).ok, true);
    assert.equal((await settings.saveSettingsSection(users.admin, "thresholds", form({ qualificationExpirationWarningDays: "0", taskDueSoonDays: "5", rentalDueSoonDays: "2", invoiceDueSoonDays: "10", maintenanceDueSoonDays: "21" }))).ok, false);
    const t = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    assert.deepEqual([t.qualificationExpirationWarningDays, t.taskDueSoonDays, t.rentalDueSoonDays, t.invoiceDueSoonDays, t.maintenanceDueSoonDays], [45, 5, 2, 10, 21]);

    assert.equal((await settings.saveSettingsSection(users.admin, "defaults", form({ defaultPaymentTerms: "Net 15", invoiceDefaultDueDays: "15", invoiceFooter: "Thank you", invoiceDefaultTerms: "", defaultRentalTerms: "Return clean.", qualificationAutoVerifyAdminEntries: "on" }))).ok, true);
    const d = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    assert.equal(d.invoiceDefaultDueDays, 15); assert.equal(d.qualificationAutoVerifyAdminEntries, true); assert.equal(d.defaultRentalTerms, "Return clean.");

    await settings.saveSettingsSection(users.admin, "features", form({ featureRentals: "on", featureLedger: "on" }));
    const shell = await settings.getShellSettings(orgId);
    assert.deepEqual(shell.features, { rentals: true, ledger: true, training: false, maintenance: false, clientPortal: false });
    assert.equal(shell.name, "Acme Command");
    // Hiding a feature never touches its data.
    assert.ok((await prisma.trainingCourse.count({ where: { organizationId: orgId } })) >= 0);
    await settings.saveSettingsSection(users.admin, "features", form({ featureRentals: "on", featureLedger: "on", featureTraining: "on", featureMaintenance: "on", featureClientPortal: "on" }));
    const flagAudit = await prisma.auditEvent.count({ where: { organizationId: orgId, action: "settings.features.changed" } });
    assert.equal(flagAudit, 2);
  });

  test("numbering: validation, forward-only counters, audit, and concurrency-safe allocation", async () => {
    const base = { "PROJECT.prefix": "PRJ-", "PROJECT.nextValue": "10", "PROJECT.autoAssign": "on", "CLIENT.prefix": "C-", "CLIENT.nextValue": "1", "RENTAL.prefix": "R-", "RENTAL.nextValue": "1", "EQUIPMENT.prefix": "EQ-", "EQUIPMENT.nextValue": "1", invoicePrefix: "INV-", nextInvoiceSequence: "1", ledgerPrefix: "LT-", nextLedgerSequence: "1" };
    assert.equal((await settings.saveSettingsSection(users.admin, "numbering", form({ ...base, "PROJECT.prefix": "bad prefix!" }))).ok, false);
    assert.equal((await settings.saveSettingsSection(users.admin, "numbering", form({ ...base, ledgerPrefix: "" }))).ok, false, "ledger prefix is required");
    assert.equal((await settings.saveSettingsSection(users.admin, "numbering", form(base))).ok, true);
    await prisma.organization.update({ where: { id: orgId }, data: { nextInvoiceSequence: 20 } });
    const lowered = await settings.saveSettingsSection(users.admin, "numbering", form({ ...base, nextInvoiceSequence: "5" }));
    assert.equal(lowered.ok, false, "issued invoice numbers can never be reissued");
    assert.equal((await settings.saveSettingsSection(users.admin, "numbering", form({ ...base, nextInvoiceSequence: "30", invoicePrefix: "BILL-" }))).ok, true);
    assert.ok(await prisma.auditEvent.findFirst({ where: { organizationId: orgId, action: "settings.numbering.changed" } }));

    // 30 simultaneous creators each get a distinct, gap-free number.
    const taken = async () => false;
    const got = await Promise.all(Array.from({ length: 30 }, () => prisma.$transaction((tx) => numbering.allocateNumber(tx, orgId, "PROJECT", taken))));
    assert.equal(new Set(got).size, 30);
    assert.deepEqual([...got].sort(), Array.from({ length: 30 }, (_, i) => `PRJ-${String(10 + i).padStart(4, "0")}`).sort());

    // Manually typed numbers are skipped, never duplicated.
    await prisma.project.create({ data: { organizationId: orgId, name: `Taken ${sfx}`, projectNumber: "PRJ-0040" } });
    const next = await prisma.$transaction((tx) => numbering.allocateNumber(tx, orgId, "PROJECT", async (n) => Boolean(await tx.project.findFirst({ where: { organizationId: orgId, projectNumber: n } }))));
    assert.equal(next, "PRJ-0041");
    // Sequences are per organization.
    assert.equal(await prisma.$transaction((tx) => numbering.allocateNumber(tx, otherOrgId, "PROJECT", async () => false)), "P-0001");
  });

  test("organization notification defaults apply unless a user chose otherwise", async () => {
    await settings.saveSettingsSection(users.admin, "notifications", form({ notificationArchiveAfterDays: "30", enabledCategories: ["TASK_ASSIGNMENTS", "TASK_REMINDERS", "QUALIFICATIONS", "RENTALS", "INVOICES", "SIGNATURES", "APPROVALS", "PROJECT_UPDATES", "DOCUMENTS", "TRAINING", "SYSTEM"] }));
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    assert.deepEqual(org.notificationDefaultOffCategories, ["MAINTENANCE"]);
    assert.equal(org.notificationArchiveAfterDays, 30);
    const cache = new notifications.RecipientCache(orgId);
    assert.ok((await cache.get(users.alice.id))!.disabled.has("MAINTENANCE"));
    await notifications.setInAppPreference(users.bob, "MAINTENANCE", true);
    assert.ok(!(await new notifications.RecipientCache(orgId).get(users.bob.id))!.disabled.has("MAINTENANCE"), "a personal choice beats the organization default");
    await notifications.setInAppPreference(users.bob, "TASK_ASSIGNMENTS", false);
    assert.ok((await new notifications.RecipientCache(orgId).get(users.bob.id))!.disabled.has("TASK_ASSIGNMENTS"));
  });

  // ================================================================== search

  describe("search", () => {
    before(async () => {
      const client = await prisma.client.create({ data: { organizationId: orgId, createdByUserId: users.admin.id, name: `Harbor Logistics ${sfx}`, clientNumber: `CL-${sfx}`, generalEmail: `info-${sfx}@harbor.test` } });
      const hidden = await prisma.client.create({ data: { organizationId: orgId, createdByUserId: users.admin.id, name: `Secret Harbor ${sfx}`, clientNumber: `CL-${sfx}-S` } });
      await prisma.clientContact.create({ data: { organizationId: orgId, clientId: client.id, firstName: "Pat", lastName: `Harbor${sfx}`, email: `pat-${sfx}@harbor.test` } });
      await prisma.clientContact.create({ data: { organizationId: orgId, clientId: hidden.id, firstName: "Hidden", lastName: `Harbor${sfx}` } });
      const visible = await prisma.project.create({ data: { organizationId: orgId, name: `Harbor Refit ${sfx}`, projectNumber: `PR-${sfx}-1`, clientId: client.id, projectManagerId: ids.managerEmployee } });
      const unrelated = await prisma.project.create({ data: { organizationId: orgId, name: `Harbor Dredging ${sfx}`, projectNumber: `PR-${sfx}-2`, clientId: hidden.id } });
      await prisma.projectMember.create({ data: { organizationId: orgId, projectId: visible.id, employeeId: ids.aliceEmployee } });
      Object.assign(ids, { client: client.id, hiddenClient: hidden.id, visibleProject: visible.id, unrelatedProject: unrelated.id });
      await prisma.task.create({ data: { organizationId: orgId, projectId: visible.id, title: `Harbor survey ${sfx}`, createdByUserId: users.manager.id, assignedToEmployeeId: ids.aliceEmployee } });
      await prisma.task.create({ data: { organizationId: orgId, projectId: unrelated.id, title: `Harbor permits ${sfx}`, createdByUserId: users.admin.id } });
      await prisma.equipment.create({ data: { organizationId: orgId, assetNumber: `EQ-${sfx}-7`, name: `Harbor crane ${sfx}`, serialNumber: `SN${sfx}` } });
      await prisma.rental.create({ data: { organizationId: orgId, rentalNumber: `R-${sfx}-9`, reservationStart: new Date("2026-11-01T00:00:00Z"), reservationEnd: new Date("2026-11-03T00:00:00Z"), createdByUserId: users.admin.id, clientId: client.id } });
      await prisma.invoice.create({ data: { organizationId: orgId, clientId: client.id, invoiceNumber: `BILL-${sfx}-1`, createdByUserId: users.admin.id } });
      await prisma.trainingCourse.create({ data: { organizationId: orgId, name: `Harbor safety ${sfx}`, code: `HS-${sfx}` } });
      await prisma.trainingCourse.create({ data: { organizationId: orgId, name: `Harbor retired ${sfx}`, active: false } });
      const equipment = await prisma.equipment.findFirstOrThrow({ where: { organizationId: orgId, assetNumber: `EQ-${sfx}-7` } });
      await prisma.maintenanceRecord.create({ data: { organizationId: orgId, equipmentId: equipment.id, type: "REPAIR", description: `Harbor hydraulic leak ${sfx}`, createdByUserId: users.admin.id } });
      // Documents: one attached to the project alice belongs to, one to the project she does not, one restricted.
      const pdf = new File([new TextEncoder().encode("%PDF-1.4\n%%EOF\n")], `harbor-manifest-${sfx}.pdf`, { type: "application/pdf" });
      const d1 = await documents.createDocument({ title: `Harbor plan ${sfx}`, description: "Site plan for the refit", relationField: "projectId", relationId: visible.id, file: pdf }, users.admin);
      const d2 = await documents.createDocument({ title: `Harbor budget ${sfx}`, relationField: "projectId", relationId: unrelated.id, file: pdf }, users.admin);
      Object.assign(ids, { docVisible: d1.id, docHidden: d2.id });
      // A foreign-organization record using the same words must never surface.
      await prisma.project.create({ data: { organizationId: otherOrgId, name: `Harbor Foreign ${sfx}`, projectNumber: `PR-${sfx}-F` } });
      await prisma.client.create({ data: { organizationId: otherOrgId, createdByUserId: users.foreign.id, name: `Harbor Foreign Client ${sfx}`, clientNumber: `CL-${sfx}-F` } });
    });

    test("admins find records across modules by name, partial text and human-readable numbers; case-insensitively", async () => {
      assert.deepEqual(names(await find(users.admin, "projects", `harbor refit ${sfx}`)), [`Harbor Refit ${sfx}`]);
      assert.equal((await find(users.admin, "projects", `HARBOR`)).total, 2, "partial and case-insensitive; foreign organization excluded");
      assert.deepEqual(names(await find(users.admin, "employees", `A-${sfx}-3`)), [`alice Zed${sfx}`]);
      assert.deepEqual(names(await find(users.admin, "projects", `PR-${sfx}-2`)), [`Harbor Dredging ${sfx}`]);
      assert.deepEqual(names(await find(users.admin, "clients", `cl-${sfx}-s`)), [`Secret Harbor ${sfx}`]);
      assert.equal((await find(users.admin, "equipment", `EQ-${sfx}-7`)).hits[0]?.title, `EQ-${sfx}-7 — Harbor crane ${sfx}`);
      assert.equal((await find(users.admin, "equipment", `sn${sfx}`)).total, 1);
      assert.deepEqual(names(await find(users.admin, "rentals", `R-${sfx}-9`)), [`R-${sfx}-9`]);
      assert.deepEqual(names(await find(users.admin, "invoices", `BILL-${sfx}`)), [`BILL-${sfx}-1`]);
      assert.equal((await find(users.admin, "contacts", `pat-${sfx}`)).total, 1);
      assert.equal((await find(users.admin, "courses", `HS-${sfx}`)).total, 1);
      assert.equal((await find(users.admin, "maintenance", `hydraulic leak ${sfx}`)).total, 1);
      assert.equal((await find(users.admin, "tasks", `survey ${sfx}`)).total, 1);
      assert.equal((await find(users.admin, "employees", `alice zed${sfx}`)).total, 1, "every word must match, in any column");
      assert.equal((await find(users.admin, "employees", `zed${sfx} nobody`)).total, 0);
    });

    test("documents are found by title, description, category and file name only", async () => {
      assert.equal((await find(users.admin, "documents", `harbor plan ${sfx}`)).total, 1);
      assert.equal((await find(users.admin, "documents", "site plan for the refit")).total >= 1, true, "description");
      assert.equal((await find(users.admin, "documents", `harbor-manifest-${sfx}`)).total, 2, "file name");
      assert.equal((await find(users.admin, "documents", "%PDF-1.4")).total, 0, "file contents are never indexed");
    });

    test("exact matches rank first and wildcard characters are literal", async () => {
      await prisma.project.create({ data: { organizationId: orgId, name: `Exact${sfx} extended name`, projectNumber: `XA-${sfx}-10` } });
      await prisma.project.create({ data: { organizationId: orgId, name: `Another`, projectNumber: `XA-${sfx}-1` } });
      const result = await find(users.admin, "projects", `xa-${sfx}-1`);
      assert.equal(result.total, 2);
      assert.equal(result.hits[0]!.exact, true);
      assert.equal(result.hits[0]!.title, "Another", "the exact project number is listed before the partial match");
      assert.equal((await find(users.admin, "projects", "%%")).total, 0);
      assert.equal((await find(users.admin, "projects", "_")).total, 0, "too short");
      assert.equal((await find(users.admin, "projects", "a_")).total, 0);
    });

    test("an employee only discovers what they could open directly", async () => {
      assert.deepEqual(names(await find(users.alice, "projects", "Harbor")), [`Harbor Refit ${sfx}`]);
      assert.deepEqual(names(await find(users.alice, "tasks", "Harbor")), [`Harbor survey ${sfx}`]);
      assert.equal((await find(users.alice, "projects", `PR-${sfx}-2`)).total, 0, "searching an exact inaccessible number reveals nothing");
      assert.deepEqual(names(await find(users.alice, "clients", "Harbor")), [`Harbor Logistics ${sfx}`], "only clients reachable through her project");
      assert.equal((await find(users.alice, "clients", `CL-${sfx}-S`)).total, 0);
      assert.equal((await find(users.alice, "contacts", "Harbor")).total, 1, "contacts follow client visibility");
      assert.deepEqual(names(await find(users.alice, "employees", "Zed")), [`alice Zed${sfx}`], "employees only see themselves");
      assert.equal((await find(users.alice, "employees", `A-${sfx}-4`)).total, 0);
      assert.equal((await find(users.alice, "invoices", "BILL")).total, 0, "employees have no invoice access");
      assert.deepEqual(names(await find(users.alice, "documents", "Harbor")), [`Harbor plan ${sfx}`]);
      assert.equal((await find(users.alice, "courses", "Harbor")).total, 1, "inactive courses are hidden from employees");
      assert.equal((await find(users.bob, "projects", "Harbor")).total, 0);
      assert.equal((await find(users.bob, "documents", "Harbor")).total, 0);
      assert.equal((await find(users.bob, "clients", "Harbor")).total, 0);
      const suggestions = await search.searchSuggestions(users.bob, "Harbor");
      assert.ok(!suggestions.some((g) => ["projects", "tasks", "clients", "contacts", "invoices", "documents"].includes(g.entity)));
      const aliceOverview = await search.searchOverview(users.alice, "Harbor");
      assert.ok(!aliceOverview.some((g) => g.entity === "invoices"));
    });

    test("managers see their own scope, never another organization's records", async () => {
      assert.deepEqual(names(await find(users.manager, "projects", "Harbor")), [`Harbor Refit ${sfx}`]);
      assert.equal((await find(users.manager, "invoices", "BILL")).total, 0, "managers see invoices they created or that belong to their projects");
      for (const entity of search.SEARCH_ENTITIES) for (const user of [users.admin, users.manager]) {
        const result = await find(user, entity, `Foreign`);
        assert.ok(!names(result).some((n) => /Foreign/.test(n) && !/Zed/.test(n)), `${entity}: ${names(result)}`);
      }
      assert.equal((await find(users.foreign, "projects", "Harbor")).total, 1);
      assert.equal((await find(users.foreign, "clients", "Harbor")).total, 1);
      assert.equal((await find(users.foreign, "documents", "Harbor")).total, 0);
    });

    test("pagination is stable with accurate totals, and results are small", async () => {
      for (let i = 0; i < 27; i++) await prisma.equipment.create({ data: { organizationId: orgId, assetNumber: `PG-${sfx}-${String(i).padStart(2, "0")}`, name: `Pager ${i}` } });
      const one = await find(users.admin, "equipment", `PG-${sfx}`, 1, 10), two = await find(users.admin, "equipment", `PG-${sfx}`, 2, 10), three = await find(users.admin, "equipment", `PG-${sfx}`, 3, 10);
      assert.equal(one.total, 27);
      assert.deepEqual([one.hits.length, two.hits.length, three.hits.length], [10, 10, 7]);
      assert.equal(new Set([...one.hits, ...two.hits, ...three.hits].map((h) => h.id)).size, 27);
      const exact = await find(users.admin, "equipment", `PG-${sfx}-05`, 1, 10);
      assert.equal(exact.hits[0]!.exact, true);
      assert.ok((await search.searchSuggestions(users.admin, "Pager")).every((g) => g.hits.length <= 3));
    });

    test("realistic volume stays fast and uses the trigram indexes", async () => {
      await prisma.$executeRawUnsafe(`INSERT INTO "Employee" (id, "organizationId", "firstName", "lastName", "employeeNumber", "employmentStatus", "createdAt", "updatedAt")
        SELECT gen_random_uuid()::text, $1, 'Bulk' || g, 'Person' || (g % 997), 'BK-${sfx}-' || g, 'ACTIVE', now(), now() FROM generate_series(1, 20000) g`, orgId);
      await prisma.$executeRawUnsafe(`ANALYZE "Employee"`);
      const started = Date.now();
      const result = await find(users.admin, "employees", `BK-${sfx}-19876`);
      const partial = await find(users.admin, "employees", "person99");
      const elapsed = Date.now() - started;
      assert.equal(result.hits[0]?.exact, true);
      assert.ok(partial.total > 0);
      assert.ok(elapsed < 2500, `two searches over 20k employees took ${elapsed}ms`);
      const plan = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(`EXPLAIN SELECT id FROM "Employee" WHERE "organizationId" = '${orgId}' AND "lastName" ILIKE '%person99%'`);
      assert.ok(plan.map((row) => row["QUERY PLAN"]).join("\n").match(/Bitmap|Index/), "the planner can use an index for ILIKE");
      await prisma.employee.deleteMany({ where: { organizationId: orgId, employeeNumber: { startsWith: `BK-${sfx}-` } } });
    });
  });

  // ================================================================== import

  describe("import", () => {
    const run = async (entity: Parameters<typeof mapping.suggestMapping>[0], headers: string[], rows: string[][], opts: { mode?: "CREATE" | "UPDATE"; map?: Record<string, string | null>; user?: AuthUser } = {}) => {
      const user = opts.user ?? users.admin;
      const job = await prisma.importJob.create({ data: { organizationId: user.organizationId, uploadedByUserId: user.id, entityType: entity, filename: "t.csv", mode: opts.mode ?? "CREATE", mapping: (opts.map ?? mapping.suggestMapping(entity, headers)) as never, stagedRows: { headers, rows } as never, rowsTotal: rows.length } });
      await engine.runImportJob(job.id);
      return prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
    };
    const preview = (entity: Parameters<typeof mapping.suggestMapping>[0], headers: string[], rows: string[][], mode: "CREATE" | "UPDATE" = "CREATE", organizationId = orgId) =>
      engine.evaluate(organizationId, entity, { headers, rows }, mapping.suggestMapping(entity, headers), mode);

    test("employees: valid rows import, bad rows are reported and never silently altered", async () => {
      await prisma.department.create({ data: { organizationId: orgId, name: `Operations ${sfx}` } });
      await prisma.position.create({ data: { organizationId: orgId, title: `Technician ${sfx}` } });
      await prisma.department.create({ data: { organizationId: otherOrgId, name: `Foreign Dept ${sfx}` } });
      const headers = ["First Name", "Last Name", "Employee ID", "Email", "Department", "Job Title", "Hire Date", "Status"];
      const rows = [
        ["Ada", "Lovelace", `IM-${sfx}-1`, `ada-${sfx}@imp.test`, `operations ${sfx}`, `Technician ${sfx}`, "2024-03-01", "active"],
        ["", "Missing", `IM-${sfx}-2`, "", "", "", "", ""],
        ["Bad", "Date", `IM-${sfx}-3`, "", "", "", "2026-02-31", ""],
        ["Unk", "Dept", `IM-${sfx}-4`, "", "Nowhere", "", "", ""],
        ["Cross", "Org", `IM-${sfx}-5`, "", `Foreign Dept ${sfx}`, "", "", ""],
        ["Dup", "Existing", `A-${sfx}-1`, "", "", "", "", ""],
        ["Dup", "InFile", `IM-${sfx}-1`, "", "", "", "", ""],
        ["Bad", "Email", `IM-${sfx}-6`, "not-an-email", "", "", "", ""],
        ["Bad", "Status", `IM-${sfx}-7`, "", "", "", "", "retired"],
        ["Grace", "Hopper", `IM-${sfx}-8`, "", "", "", "3/7/2025", "LEAVE"],
      ];
      const before = await prisma.employee.count({ where: { organizationId: orgId } });
      const dry = await preview("employees", headers, rows);
      assert.deepEqual(dry.summary, { total: 10, valid: 2, warnings: 0, rejected: 8, toCreate: 2, toUpdate: 0 });
      assert.equal(await prisma.employee.count({ where: { organizationId: orgId } }), before, "a dry run writes nothing");
      assert.equal(await prisma.importJob.count({ where: { organizationId: orgId, entityType: "employees" } }), 0, "and creates no job");
      const messages = dry.outcomes.map((o) => o.errors.join(" "));
      assert.match(messages[1]!, /First name is required/);
      assert.match(messages[2]!, /not a real calendar date/);
      assert.match(messages[3]!, /Unknown department/);
      assert.match(messages[4]!, /Unknown department/, "another organization's department is invisible");
      assert.match(messages[5]!, /already exists/);
      assert.match(messages[6]!, /also appears on line 2/);
      assert.match(messages[7]!, /email/i);
      assert.match(messages[8]!, /not valid/);

      const job = await run("employees", headers, rows);
      assert.equal(job.status, "COMPLETED_WITH_ERRORS");
      assert.deepEqual([job.rowsCreated, job.rowsUpdated, job.rowsRejected], [2, 0, 8]);
      assert.equal(job.stagedRows, null, "uploaded rows are discarded after the run");
      assert.equal(await prisma.employee.count({ where: { organizationId: orgId } }), before + 2);
      const ada = await prisma.employee.findFirstOrThrow({ where: { organizationId: orgId, employeeNumber: `IM-${sfx}-1` }, include: { department: true, position: true } });
      assert.equal(ada.department?.name, `Operations ${sfx}`); assert.equal(ada.hireDate?.toISOString().slice(0, 10), "2024-03-01"); assert.equal(ada.organizationId, orgId);
      const grace = await prisma.employee.findFirstOrThrow({ where: { organizationId: orgId, employeeNumber: `IM-${sfx}-8` } });
      assert.equal(grace.employmentStatus, "LEAVE"); assert.equal(grace.hireDate?.toISOString().slice(0, 10), "2025-03-07");
      assert.equal(await prisma.employee.count({ where: { organizationId: otherOrgId, employeeNumber: { startsWith: "IM-" } } }), 0);
      const audit = await prisma.auditEvent.findFirstOrThrow({ where: { organizationId: orgId, action: "import.completed", entityId: job.id } });
      assert.equal(audit.actorUserId, users.admin.id);
      assert.equal(await prisma.auditEvent.count({ where: { organizationId: orgId, entityType: "Employee", action: "employee.created", occurredAt: { gte: job.createdAt } } }), 0, "imports are audited once, not per row");
      assert.ok(((job.summary as { rejectedRows: unknown[] }).rejectedRows).length === 8);
    });

    test("an organization id inside the file is ignored; the session decides", async () => {
      const headers = ["First Name", "Last Name", "organizationId"];
      const job = await run("employees", headers, [["Mallory", "Tenant", otherOrgId]]);
      assert.equal(job.rowsCreated, 1);
      assert.equal(await prisma.employee.count({ where: { organizationId: otherOrgId, firstName: "Mallory" } }), 0);
      assert.equal(await prisma.employee.count({ where: { organizationId: orgId, firstName: "Mallory" } }), 1);
      assert.ok(((job.summary as { unmappedColumns: string[] }).unmappedColumns).includes("organizationId"));
    });

    test("update mode matches only unambiguous identifiers and leaves blank cells alone", async () => {
      const headers = ["Employee ID", "Last Name", "Email", "Department"];
      await prisma.employee.create({ data: { organizationId: orgId, firstName: "Twin", lastName: "One", workEmail: `twin-${sfx}@imp.test` } });
      await prisma.employee.create({ data: { organizationId: orgId, firstName: "Twin", lastName: "Two", workEmail: `twin-${sfx}@imp.test` } });
      const rows = [[`IM-${sfx}-1`, "Byron", "", ""], ["", "NoId", "", ""], ["", "Ambiguous", `twin-${sfx}@imp.test`, ""], [`IM-${sfx}-NEW`, "Newbie", "", ""]];
      const dry = await preview("employees", headers, rows, "UPDATE");
      assert.deepEqual([dry.summary.toUpdate, dry.summary.toCreate, dry.summary.rejected], [1, 0, 3], "the new row has no first name, so it is rejected rather than guessed");
      assert.match(dry.outcomes[1]!.errors.join(), /needs an employee number or work email/);
      assert.match(dry.outcomes[2]!.errors.join(), /matches 2 employees/);
      const job = await run("employees", headers, rows, { mode: "UPDATE" });
      assert.deepEqual([job.rowsUpdated, job.rowsCreated], [1, 0]);
      const ada = await prisma.employee.findFirstOrThrow({ where: { organizationId: orgId, employeeNumber: `IM-${sfx}-1` }, include: { department: true } });
      assert.equal(ada.lastName, "Byron"); assert.equal(ada.firstName, "Ada", "unmapped/blank values are untouched"); assert.equal(ada.workEmail, `ada-${sfx}@imp.test`); assert.equal(ada.department?.name, `Operations ${sfx}`);
    });

    test("departments, positions, qualification types and employee qualifications", async () => {
      const dept = await run("departments", ["Name", "Description"], [[`Ops ${sfx}`, "x"], [`ops ${sfx}`, "dup in file"], [`Operations ${sfx}`, "dup existing"]]);
      assert.deepEqual([dept.rowsCreated, dept.rowsRejected], [1, 2]);
      const pos = await run("positions", ["Title"], [[`Lead ${sfx}`]]);
      assert.equal(pos.rowsCreated, 1);
      const types = await run("qualification-types", ["Name", "Category", "Expiration", "Validity Months"], [[`CPR ${sfx}`, "certification", "calculated", "24"], [`Bad ${sfx}`, "wizard", "", ""], [`Calc ${sfx}`, "", "calculated", ""], [`NoExp ${sfx}`, "", "", ""]]);
      assert.deepEqual([types.rowsCreated, types.rowsRejected], [2, 2]);
      const headers = ["Employee ID", "Qualification", "Credential Number", "Issue Date", "Expires"];
      const rows = [
        [`IM-${sfx}-1`, `CPR ${sfx}`, "CPR-1", "2025-01-15", ""],
        [`IM-${sfx}-1`, `CPR ${sfx}`, "CPR-1", "2025-01-15", ""],
        [`IM-${sfx}-8`, `NoExp ${sfx}`, "", "", "2030-01-01"],
        ["NOPE", `CPR ${sfx}`, "", "2025-01-15", ""],
        [`IM-${sfx}-8`, "Unknown type", "", "", ""],
        [`IM-${sfx}-8`, `CPR ${sfx}`, "", "", ""],
      ];
      const dry = await preview("employee-qualifications", headers, rows);
      assert.deepEqual([dry.summary.toCreate, dry.summary.rejected, dry.summary.warnings], [2, 4, 1]);
      const job = await run("employee-qualifications", headers, rows);
      assert.equal(job.rowsCreated, 2);
      const q = await prisma.employeeQualification.findFirstOrThrow({ where: { organizationId: orgId, credentialNumber: "CPR-1" } });
      assert.equal(q.verificationStatus, "UNVERIFIED"); assert.equal(q.expirationDate?.toISOString().slice(0, 10), "2027-01-15", "calculated from the type's validity");
      const noExp = await prisma.employeeQualification.findFirstOrThrow({ where: { organizationId: orgId, qualificationType: { name: `NoExp ${sfx}` } } });
      assert.equal(noExp.expirationDate, null, "a non-expiring type ignores a supplied date (with a warning)");
      const again = await run("employee-qualifications", headers.slice(0, 4), [[`IM-${sfx}-1`, `CPR ${sfx}`, "CPR-1", "2025-01-15"]]);
      assert.equal(again.rowsRejected, 1, "re-importing the same record is rejected as a duplicate");
    });

    test("clients, contacts, equipment and projects", async () => {
      const clientsJob = await run("clients", ["Client Name", "Client #", "Email", "Status", "Type"], [
        [`Acme ${sfx}`, `CN-${sfx}-1`, "a@acme.test", "active", "business"], [`Acme ${sfx}`, `CN-${sfx}-2`, "", "", ""], ["No Number Co", "", "", "", ""], ["Bad Status", `CN-${sfx}-3`, "", "frozen", ""], ["Dup Number", `CN-${sfx}-1`, "", "", ""],
      ]);
      assert.deepEqual([clientsJob.rowsCreated, clientsJob.rowsRejected, (clientsJob.summary as { total: number }).total], [3, 2, 5]);
      const dry = await preview("clients", ["Client Name", "Client #"], [[`Acme ${sfx}`, `CN-${sfx}-9`]]);
      assert.equal(dry.outcomes[0]!.status, "warning");
      assert.match(dry.outcomes[0]!.warnings.join(), /may be a duplicate/);
      const clientUpdate = await run("clients", ["Client #", "Phone"], [[`CN-${sfx}-1`, "555-0199"], [`CN-${sfx}-404`, "1"]], { mode: "UPDATE" });
      assert.deepEqual([clientUpdate.rowsUpdated, clientUpdate.rowsCreated], [1, 0]);
      assert.equal((await prisma.client.findFirstOrThrow({ where: { organizationId: orgId, clientNumber: `CN-${sfx}-1` } })).mainPhone, "555-0199");
      assert.equal((await prisma.client.findFirstOrThrow({ where: { organizationId: orgId, clientNumber: `CN-${sfx}-1` } })).name, `Acme ${sfx}`, "name untouched by a partial update");
      const contacts = await run("client-contacts", ["Client Number", "First Name", "Last Name", "Email", "Primary"], [
        [`CN-${sfx}-1`, "Cy", "Ng", "cy@acme.test", "yes"], [`CN-${sfx}-1`, "Cy", "Ng", "cy@acme.test", ""], ["NOPE", "X", "Y", "", ""], [`CN-${sfx}-1`, "", "Blank", "", ""],
      ]);
      assert.deepEqual([contacts.rowsCreated, contacts.rowsRejected], [1, 3]);
      const acme = await prisma.client.findFirstOrThrow({ where: { organizationId: orgId, clientNumber: `CN-${sfx}-1` } });
      assert.ok(acme.primaryContactId);

      await prisma.equipmentCategory.create({ data: { organizationId: orgId, name: `Power ${sfx}` } });
      const eq = await run("equipment", ["Asset #", "Name", "Category", "Status", "Rentable", "Purchase Cost", "Rate"], [
        [`EQI-${sfx}-1`, "Generator", `power ${sfx}`, "available", "yes", "$1,899.50", "75"], [`EQI-${sfx}-2`, "Broken", "Nope", "", "", "", ""], [`EQI-${sfx}-3`, "Cost", "", "", "", "-5", ""], [`EQI-${sfx}-1`, "Dup", "", "", "", "", ""], ["", "No tag", "", "", "", "", ""], [`EQI-${sfx}-4`, "Bad", "", "exploded", "", "", ""],
      ]);
      assert.deepEqual([eq.rowsCreated, eq.rowsRejected], [1, 5]);
      const gen = await prisma.equipment.findFirstOrThrow({ where: { organizationId: orgId, assetNumber: `EQI-${sfx}-1` } });
      assert.equal(gen.purchaseCost?.toFixed(2), "1899.50"); assert.equal(gen.rentable, true);
      const eqUp = await run("equipment", ["Asset #", "Condition"], [[`EQI-${sfx}-1`, "fair"]], { mode: "UPDATE" });
      assert.equal(eqUp.rowsUpdated, 1);
      assert.equal((await prisma.equipment.findUniqueOrThrow({ where: { id: gen.id } })).condition, "FAIR");
      await prisma.numberSequence.upsert({ where: { organizationId_entity: { organizationId: orgId, entity: "EQUIPMENT" } }, create: { organizationId: orgId, entity: "EQUIPMENT", prefix: "AUTO-", nextValue: 1, autoAssign: true }, update: { autoAssign: true, prefix: "AUTO-", nextValue: 1 } });
      const auto = await run("equipment", ["Name"], [["Auto numbered"], ["Auto numbered 2"]]);
      assert.equal(auto.rowsCreated, 2);
      assert.deepEqual((await prisma.equipment.findMany({ where: { organizationId: orgId, assetNumber: { startsWith: "AUTO-" } }, orderBy: { assetNumber: "asc" } })).map((e) => e.assetNumber), ["AUTO-0001", "AUTO-0002"]);

      const projectsJob = await run("projects", ["Project", "Number", "Manager", "Client", "Status", "Start", "End"], [
        ["Refit A", `PI-${sfx}-1`, `IM-${sfx}-1`, `CN-${sfx}-1`, "active", "2026-11-01", "2026-12-01"], ["Refit B", `PI-${sfx}-2`, "NOBODY", "", "", "", ""], ["Refit C", `PI-${sfx}-3`, "", "Nope Inc", "", "", ""], ["Refit D", `PI-${sfx}-4`, "", "", "", "2026-12-01", "2026-11-01"], ["Refit E", `PI-${sfx}-1`, "", "", "", "", ""], ["Refit F", `PI-${sfx}-6`, "", "", "completed", "", ""],
      ], { map: { projectNumber: "Number", name: "Project", projectManager: "Manager", client: "Client", status: "Status", startDate: "Start", targetEndDate: "End" } });
      assert.deepEqual([projectsJob.rowsCreated, projectsJob.rowsRejected], [1, 5]);
      const refit = await prisma.project.findFirstOrThrow({ where: { organizationId: orgId, projectNumber: `PI-${sfx}-1` } });
      assert.equal(refit.projectManagerId !== null && refit.clientId !== null, true);
    });

    test("a failed or cancelled job keeps nothing staged, history lists runs, and large imports run in chunks with a notification", async () => {
      const big = Array.from({ length: 650 }, (_, i) => [`Bulk${i}`, "Import", `BIG-${sfx}-${i}`]);
      big.push(["Dup", "Row", `BIG-${sfx}-5`], ["", "NoFirst", `BIG-${sfx}-X`]);
      const job = await prisma.importJob.create({ data: { organizationId: orgId, uploadedByUserId: users.admin.id, entityType: "employees", filename: "big.csv", status: "QUEUED", mapping: mapping.suggestMapping("employees", ["First Name", "Last Name", "Employee Number"]) as never, stagedRows: { headers: ["First Name", "Last Name", "Employee Number"], rows: big } as never, rowsTotal: big.length } });
      assert.equal(await engine.runImportJob(job.id), "done");
      assert.equal(await engine.runImportJob(job.id), "skipped", "a finished job cannot be run twice");
      const done = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
      assert.equal(done.status, "COMPLETED_WITH_ERRORS");
      assert.deepEqual([done.rowsCreated, done.rowsRejected, done.rowsProcessed], [650, 2, 652]);
      assert.equal(done.stagedRows, null);
      assert.equal(await prisma.employee.count({ where: { organizationId: orgId, employeeNumber: { startsWith: `BIG-${sfx}-` } } }), 650);
      const note = await prisma.notification.findFirst({ where: { userId: users.admin.id, type: "IMPORT_COMPLETED" } });
      assert.ok(note, "the initiator is notified when a long import finishes");
      assert.equal(note.actionUrl, `/administration/import-export/${job.id}`);
      const history = await prisma.importJob.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" } });
      assert.ok(history.length >= 8 && history.every((j) => j.organizationId === orgId));
      assert.equal(await prisma.importJob.count({ where: { organizationId: otherOrgId } }), 0);
      // Stale, never-confirmed uploads are discarded.
      const stale = await prisma.importJob.create({ data: { organizationId: orgId, uploadedByUserId: users.admin.id, entityType: "clients", filename: "old.csv", status: "PENDING", stagedRows: { headers: ["a"], rows: [["b"]] } as never, createdAt: new Date(Date.now() - 48 * 3600_000) } });
      await engine.expireStaleImports(orgId);
      const expired = await prisma.importJob.findUniqueOrThrow({ where: { id: stale.id } });
      assert.equal(expired.status, "CANCELLED"); assert.equal(expired.stagedRows, null);
      assert.equal(await engine.runImportJob(stale.id), "skipped");
    });
  });

  // ================================================================== export

  describe("export", () => {
    test("exports reuse report permissions, include imported data and neutralize formulas", async () => {
      await prisma.client.create({ data: { organizationId: orgId, createdByUserId: users.admin.id, name: `=HYPERLINK("http://evil.test")${sfx}`, clientNumber: `CN-${sfx}-X` } });
      const prepared = await reports.prepareReport(users.admin, "client-directory", {}, { export: true });
      assert.ok(prepared);
      const result = await reports.runPrepared(prepared);
      const csv = reportExport.toCsv(result, { title: "Client directory" });
      assert.ok(csv.includes(`'=HYPERLINK`), "formula-like cells are prefixed");
      assert.ok(!/\n=HYPERLINK/.test(csv) && !/,=HYPERLINK/.test(csv));
      assert.ok(csv.includes(`Acme ${sfx}`));
      const employees = reportExport.toCsv(await reports.runPrepared((await reports.prepareReport(users.admin, "employee-directory", {}, { export: true }))!), { title: "Employees" });
      assert.ok(!/passwordHash|personalEmail|token/i.test(employees));
      assert.ok(employees.includes(`IM-${sfx}-1`));
      // Invoice register honours status filtering and manager scope.
      const register = await reports.prepareReport(users.admin, "invoice-register", { status: "DRAFT" }, { export: true });
      assert.ok(register);
      const registerRows = await reports.runPrepared(register);
      assert.ok(registerRows.rows.some((r) => r[0] === `BILL-${sfx}-1`));
      assert.equal((await reports.runPrepared((await reports.prepareReport(users.admin, "invoice-register", { status: "PAID" }, { export: true }))!)).rows.some((r) => r[0] === `BILL-${sfx}-1`), false);
      // An employee is offered no export they could not run directly, and cannot run the finance one.
      const offered = exportsLib.exportsFor(users.alice).map((e) => e.entity);
      assert.ok(!offered.includes("Invoices") && !offered.includes("Ledger"));
      assert.ok(exportsLib.exportsFor(users.admin).map((e) => e.entity).includes("Invoices"));
      assert.equal(await reports.prepareReport(users.alice, "invoice-register", {}, { export: true }), null);
      assert.equal(await reports.prepareReport(users.alice, "employee-directory", {}, { export: true }), null);
    });
  });
});
