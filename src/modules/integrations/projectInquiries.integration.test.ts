/**
 * External project inquiry API checks against a real PostgreSQL.
 * Opt-in (writes data): INTEGRATION_TESTS=1 DATABASE_URL=... npm run test:integration
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Module from "node:module";
import test, { after, before, describe } from "node:test";

type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const originalLoad = loader._load;
loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
  return request === "server-only" ? {} : originalLoad.call(this, request, ...rest);
};

const enabled = process.env.INTEGRATION_TESTS === "1";

describe("external project inquiry API (database)", { skip: !enabled }, () => {
  let prisma: typeof import("@/lib/prisma").prisma;
  let keys: typeof import("@/lib/apiKeys/keys");
  let inquiries: typeof import("@/modules/integrations/projectInquiries");
  let rateLimit: typeof import("@/lib/portal/rate-limit");
  let route: typeof import("@/app/api/v1/projects/inquiries/route");

  const sfx = randomUUID().slice(0, 8);
  let orgId = "";
  let otherOrgId = "";

  const basePayload = (overrides: Record<string, unknown> = {}) => ({
    name: "Jane Smith",
    email: "jane@example.com",
    phone: "555-0100",
    organization: "Example Events LLC",
    subject: "Event Communications Support",
    service: "Field Communications",
    message: "We are interested in communications support for an upcoming event.",
    ...overrides,
  });

  const makeKey = async (organizationId: string, name: string, source = "acs-website", permissions: Array<"PROJECT_INQUIRIES_CREATE"> = ["PROJECT_INQUIRIES_CREATE"]) => {
    const { key, hash, prefix } = keys.generateApiKey();
    const record = await prisma.apiKey.create({ data: { organizationId, name, keyHash: hash, keyPrefix: prefix, permissions, defaultSource: source } });
    return { plaintext: key, record };
  };

  const request = (body: unknown, authorization?: string, extraHeaders: Record<string, string> = {}) =>
    new Request("http://local.test/api/v1/projects/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}), ...extraHeaders },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  before(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    keys = await import("@/lib/apiKeys/keys");
    inquiries = await import("@/modules/integrations/projectInquiries");
    rateLimit = await import("@/lib/portal/rate-limit");
    route = await import("@/app/api/v1/projects/inquiries/route");

    const org = await prisma.organization.create({ data: { name: `Inquiry org ${sfx}` } });
    const other = await prisma.organization.create({ data: { name: `Inquiry other org ${sfx}` } });
    orgId = org.id;
    otherOrgId = other.id;
  });

  after(async () => { await prisma?.$disconnect(); });

  test("creates an ordinary INQUIRY-status project with the submission preserved", async () => {
    const { record } = await makeKey(orgId, `ACS Website ${sfx}`);
    const result = await inquiries.createProjectInquiry(
      { id: record.id, organizationId: orgId, name: record.name, permissions: record.permissions, defaultSource: record.defaultSource },
      inquiries.inquirySchema.parse(basePayload({ submissionId: `sub-${sfx}-1` })),
    );
    assert.equal(result.status, 201);
    assert.equal(result.duplicate, false);
    assert.equal(result.project.status, "INQUIRY");

    const project = await prisma.project.findUniqueOrThrow({ where: { id: result.project.id }, include: { activities: true } });
    assert.equal(project.organizationId, orgId);
    assert.equal(project.status, "INQUIRY");
    assert.equal(project.name, "Event Communications Support");
    assert.equal(project.clientName, "Example Events LLC");
    assert.equal(project.clientId, null, "no Client record is created automatically");

    const activity = project.activities.find((a) => a.content.includes("New inquiry received"));
    assert.ok(activity, "activity history preserves the submission");
    assert.match(activity!.content, /Jane Smith/);
    assert.match(activity!.content, /jane@example\.com/);
    assert.match(activity!.content, /555-0100/);
    assert.match(activity!.content, /Example Events LLC/);
    assert.match(activity!.content, /Field Communications/);
    assert.match(activity!.content, /communications support for an upcoming event/);
  });

  test("falls back to a descriptive title when no subject is supplied", async () => {
    const { record } = await makeKey(orgId, `ACS Website ${sfx}-2`);
    const result = await inquiries.createProjectInquiry(
      { id: record.id, organizationId: orgId, name: record.name, permissions: record.permissions, defaultSource: record.defaultSource },
      inquiries.inquirySchema.parse(basePayload({ subject: undefined, submissionId: `sub-${sfx}-2` })),
    );
    const project = await prisma.project.findUniqueOrThrow({ where: { id: result.project.id } });
    assert.equal(project.name, "Website inquiry from Jane Smith");
  });

  test("a retried identical submission returns the existing project, not a duplicate", async () => {
    const { record } = await makeKey(orgId, `ACS Website ${sfx}-3`);
    const apiKey = { id: record.id, organizationId: orgId, name: record.name, permissions: record.permissions, defaultSource: record.defaultSource };
    const payload = inquiries.inquirySchema.parse(basePayload({ submissionId: `sub-${sfx}-3`, subject: `Retry subject ${sfx}` }));
    const first = await inquiries.createProjectInquiry(apiKey, payload);
    const second = await inquiries.createProjectInquiry(apiKey, payload);
    assert.equal(second.duplicate, true);
    assert.equal(second.project.id, first.project.id);
    assert.equal(await prisma.project.count({ where: { organizationId: orgId, name: payload.subject! } }), 1);
  });

  test("concurrent identical submissions create exactly one project", async () => {
    const { record } = await makeKey(orgId, `ACS Website ${sfx}-4`);
    const apiKey = { id: record.id, organizationId: orgId, name: record.name, permissions: record.permissions, defaultSource: record.defaultSource };
    const payload = inquiries.inquirySchema.parse(basePayload({ submissionId: `sub-${sfx}-4`, subject: `Concurrent ${sfx}` }));
    const results = await Promise.all([inquiries.createProjectInquiry(apiKey, payload), inquiries.createProjectInquiry(apiKey, payload)]);
    const ids = new Set(results.map((r) => r.project.id));
    assert.equal(ids.size, 1, "both requests resolve to the same project");
    assert.equal(results.filter((r) => r.duplicate).length, 1, "exactly one request observes the duplicate");
    assert.equal(await prisma.project.count({ where: { organizationId: orgId, name: `Concurrent ${sfx}` } }), 1);
  });

  test("reusing a submission ID with different content is a conflict", async () => {
    const { record } = await makeKey(orgId, `ACS Website ${sfx}-5`);
    const apiKey = { id: record.id, organizationId: orgId, name: record.name, permissions: record.permissions, defaultSource: record.defaultSource };
    const submissionId = `sub-${sfx}-5`;
    await inquiries.createProjectInquiry(apiKey, inquiries.inquirySchema.parse(basePayload({ submissionId })));
    await assert.rejects(
      () => inquiries.createProjectInquiry(apiKey, inquiries.inquirySchema.parse(basePayload({ submissionId, message: "A completely different message." }))),
      inquiries.InquiryConflictError,
    );
  });

  test("the same submissionId is independent across different API keys", async () => {
    const { record: keyA } = await makeKey(orgId, `Key A ${sfx}`);
    const { record: keyB } = await makeKey(orgId, `Key B ${sfx}`);
    const submissionId = `shared-${sfx}`;
    const resultA = await inquiries.createProjectInquiry(
      { id: keyA.id, organizationId: orgId, name: keyA.name, permissions: keyA.permissions, defaultSource: keyA.defaultSource },
      inquiries.inquirySchema.parse(basePayload({ submissionId, subject: `Key A subject ${sfx}` })),
    );
    const resultB = await inquiries.createProjectInquiry(
      { id: keyB.id, organizationId: orgId, name: keyB.name, permissions: keyB.permissions, defaultSource: keyB.defaultSource },
      inquiries.inquirySchema.parse(basePayload({ submissionId, subject: `Key B subject ${sfx}` })),
    );
    assert.notEqual(resultA.project.id, resultB.project.id);
  });

  // ============================================================= HTTP route

  test("rejects a request with no Authorization header", async () => {
    const response = await route.POST(request(basePayload()));
    assert.equal(response.status, 401);
  });

  test("rejects an unknown API key", async () => {
    const response = await route.POST(request(basePayload(), "Bearer ao_live_not-a-real-key"));
    assert.equal(response.status, 401);
  });

  test("rejects a revoked API key", async () => {
    const { plaintext, record } = await makeKey(orgId, `Revoked ${sfx}`);
    await prisma.apiKey.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    const response = await route.POST(request(basePayload(), `Bearer ${plaintext}`));
    assert.equal(response.status, 401);
  });

  test("rejects a key without the required permission", async () => {
    const { plaintext } = await makeKey(orgId, `No permission ${sfx}`, "acs-website", []);
    const response = await route.POST(request(basePayload({ submissionId: `sub-${sfx}-perm` }), `Bearer ${plaintext}`));
    assert.equal(response.status, 403);
  });

  test("validates required fields and email format", async () => {
    const { plaintext } = await makeKey(orgId, `Validation ${sfx}`);
    const missing = await route.POST(request({ name: "No Email" }, `Bearer ${plaintext}`));
    assert.equal(missing.status, 400);
    const badEmail = await route.POST(request(basePayload({ email: "not-an-email" }), `Bearer ${plaintext}`));
    assert.equal(badEmail.status, 400);
  });

  test("rejects an oversized request body", async () => {
    const { plaintext } = await makeKey(orgId, `Size ${sfx}`);
    const response = await route.POST(request(basePayload({ message: "x".repeat(20_000) }), `Bearer ${plaintext}`));
    assert.equal(response.status, 413);
  });

  test("end-to-end: creates a project and returns its id and status", async () => {
    rateLimit.resetRateLimitsForTests();
    const { plaintext } = await makeKey(orgId, `End to end ${sfx}`);
    const response = await route.POST(request(basePayload({ submissionId: `sub-${sfx}-e2e` }), `Bearer ${plaintext}`));
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.project.status, "INQUIRY");
    assert.equal(body.duplicate, false);
    assert.ok(body.project.id);
  });

  test("an authorized retry of the same submission returns 200 with duplicate:true", async () => {
    rateLimit.resetRateLimitsForTests();
    const { plaintext } = await makeKey(orgId, `Retry ${sfx}`);
    const payload = basePayload({ submissionId: `sub-${sfx}-retry` });
    const first = await route.POST(request(payload, `Bearer ${plaintext}`));
    assert.equal(first.status, 201);
    const second = await route.POST(request(payload, `Bearer ${plaintext}`));
    assert.equal(second.status, 200);
    const body = await second.json();
    assert.equal(body.duplicate, true);
  });

  test("an API key only creates projects in its own organization", async () => {
    rateLimit.resetRateLimitsForTests();
    const { plaintext } = await makeKey(otherOrgId, `Other org ${sfx}`);
    const response = await route.POST(request(basePayload({ submissionId: `sub-${sfx}-isolated`, organization: `__should_be_ignored__${sfx}` }), `Bearer ${plaintext}`));
    assert.equal(response.status, 201);
    const body = await response.json();
    const project = await prisma.project.findUniqueOrThrow({ where: { id: body.project.id } });
    assert.equal(project.organizationId, otherOrgId);
    assert.equal(await prisma.project.count({ where: { organizationId: orgId, clientName: `__should_be_ignored__${sfx}` } }), 0);
  });

  test("enforces a request rate limit per API key", async () => {
    rateLimit.resetRateLimitsForTests();
    const { plaintext } = await makeKey(orgId, `Rate limited ${sfx}`);
    let sawLimit = false;
    for (let i = 0; i < 25; i++) {
      const response = await route.POST(request(basePayload({ submissionId: `sub-${sfx}-rate-${i}` }), `Bearer ${plaintext}`));
      if (response.status === 429) sawLimit = true;
    }
    assert.ok(sawLimit, "expected the rate limit to trigger within 25 requests");
  });
});
