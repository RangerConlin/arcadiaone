/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "@/lib/prisma";
import { formatName } from "@/lib/format";
import { employeeSchema, departmentSchema, positionSchema } from "@/modules/people/validation";
import { clientSchema, contactSchema } from "@/modules/clients/validation";
import { projectSchema } from "@/modules/projects/validation";
import { qualificationTypeSchema } from "@/modules/qualifications/validation";
import { calculateExpirationDate } from "@/modules/qualifications/status";
import { allocateNumber, shouldAutoAssign } from "@/modules/settings/numbering";
import type { EntityDef, ImportEntity, RowCheck } from "./types";
import { clean, lower, parseBoolCell, parseDateCell, parseDecimalCell, parseEnumCell, parseIntCell, type Parsed } from "./values";

const EMPLOYMENT = ["ACTIVE", "INACTIVE", "LEAVE", "TERMINATED"] as const;
const CLIENT_STATUS = ["PROSPECT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const;
const CLIENT_TYPE = ["BUSINESS", "GOVERNMENT", "NONPROFIT", "INDIVIDUAL", "OTHER"] as const;
const PROJECT_STATUS = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED", "ARCHIVED"] as const;
const PROJECT_PRIORITY = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const QUAL_CATEGORY = ["CERTIFICATION", "LICENSE", "QUALIFICATION", "AUTHORIZATION", "INTERNAL"] as const;
const EXPIRATION = ["DOES_NOT_EXPIRE", "TRACKED", "CALCULATED"] as const;
const EQUIP_STATUS = ["AVAILABLE", "RESERVED", "PREPARING", "CHECKED_OUT", "INSPECTION", "MAINTENANCE", "OUT_OF_SERVICE", "LOST"] as const;
const EQUIP_CONDITION = ["NEW", "EXCELLENT", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;
const RATE_UNIT = ["FLAT", "DAILY", "WEEKLY"] as const;
const CONTACT_METHOD = ["EMAIL", "PHONE", "MOBILE"] as const;

/** Collects problems while coercing cells. */
function collector() {
  const errors: string[] = [], warnings: string[] = [];
  const take = <T,>(result: Parsed<T>): T | null => { if (result.ok) return result.value; errors.push(result.error); return null; };
  const need = (value: string, label: string) => { if (!clean(value)) errors.push(`${label} is required.`); };
  return { errors, warnings, take, need };
}
const issue = (error: { issues: Array<{ message: string }> }) => [...new Set(error.issues.map((i) => i.message))];
const failed = (label: string, errors: string[], warnings: string[]): RowCheck => ({ action: "skip", errors, warnings, label });
const pick = <T extends Record<string, unknown>>(data: T, keys: string[]) => Object.fromEntries(Object.entries(data).filter(([key]) => keys.includes(key)));
const provided = (values: Record<string, string>, map: Record<string, string>) => Object.entries(map).filter(([field]) => clean(values[field])).map(([, dbKey]) => dbKey);

function duplicateGuard() {
  const seen = new Map<string, number>();
  return (key: string, line: number, what: string, errors: string[]) => {
    if (!key) return;
    const first = seen.get(key);
    if (first !== undefined) errors.push(`${what} also appears on line ${first} of this file.`);
    else seen.set(key, line);
  };
}

// ---------------------------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------------------------
type EmployeeCtx = {
  byNumber: Map<string, { id: string; firstName: string; lastName: string }>;
  byEmail: Map<string, Array<{ id: string; firstName: string; lastName: string }>>;
  departments: Map<string, { id: string; active: boolean }>;
  positions: Map<string, { id: string; active: boolean }>;
  dup: ReturnType<typeof duplicateGuard>;
};
const employeeKeys = { employeeNumber: "employeeNumber", firstName: "firstName", lastName: "lastName", middleName: "middleName", preferredName: "preferredName", suffix: "suffix", workEmail: "workEmail", personalEmail: "personalEmail", workPhone: "workPhone", mobilePhone: "mobilePhone", department: "departmentId", position: "positionId", supervisorEmployeeNumber: "supervisorId", employmentStatus: "employmentStatus", hireDate: "hireDate", separationDate: "separationDate", notes: "notes" };

const employees: EntityDef<EmployeeCtx> = {
  key: "employees", label: "Employees", description: "People records (no user accounts are created).",
  updateIdentity: "Employee number, or a work email that matches exactly one employee.",
  guidance: ["Department and position must already exist (matched by name, ignoring case); unknown names are rejected.", "Employment status defaults to ACTIVE. Dates use YYYY-MM-DD.", "Update mode leaves cells you blank out unchanged."],
  fields: [
    { key: "employeeNumber", label: "Employee number", aliases: ["employee id", "employee #", "emp no", "emp id", "staff number"], help: "Unique within the organization.", example: "E-1001" },
    { key: "firstName", label: "First name", required: true, aliases: ["given name", "first"], help: "Required.", example: "Jordan" },
    { key: "lastName", label: "Last name", required: true, aliases: ["surname", "family name", "last"], help: "Required.", example: "Rivera" },
    { key: "middleName", label: "Middle name", help: "Optional.", example: "" },
    { key: "preferredName", label: "Preferred name", aliases: ["nickname"], help: "Optional.", example: "" },
    { key: "suffix", label: "Suffix", help: "Optional.", example: "" },
    { key: "workEmail", label: "Work email", aliases: ["email", "email address", "work e-mail"], help: "Must be a valid address.", example: "jordan.rivera@example.com" },
    { key: "personalEmail", label: "Personal email", help: "Optional.", example: "" },
    { key: "workPhone", label: "Work phone", aliases: ["phone", "office phone"], help: "Optional.", example: "555-0100" },
    { key: "mobilePhone", label: "Mobile phone", aliases: ["cell", "cell phone", "mobile"], help: "Optional.", example: "" },
    { key: "department", label: "Department", help: "Existing department name.", example: "Operations" },
    { key: "position", label: "Position", aliases: ["job title", "title"], help: "Existing position title.", example: "Field Technician" },
    { key: "supervisorEmployeeNumber", label: "Supervisor employee number", aliases: ["supervisor id", "manager id"], help: "Employee number of an existing employee.", example: "" },
    { key: "employmentStatus", label: "Employment status", aliases: ["status"], help: "ACTIVE, INACTIVE, LEAVE or TERMINATED.", example: "ACTIVE" },
    { key: "hireDate", label: "Hire date", aliases: ["start date", "date hired"], help: "YYYY-MM-DD.", example: "2024-03-01" },
    { key: "separationDate", label: "Separation date", aliases: ["termination date", "end date"], help: "YYYY-MM-DD.", example: "" },
    { key: "notes", label: "Notes", help: "Optional.", example: "" },
  ],
  async load(organizationId) {
    const [rows, departments, positions] = await Promise.all([
      prisma.employee.findMany({ where: { organizationId }, select: { id: true, employeeNumber: true, workEmail: true, firstName: true, lastName: true } }),
      prisma.department.findMany({ where: { organizationId }, select: { id: true, name: true, active: true } }),
      prisma.position.findMany({ where: { organizationId }, select: { id: true, title: true, active: true } }),
    ]);
    const byNumber = new Map<string, EmployeeCtx["byNumber"] extends Map<string, infer V> ? V : never>(), byEmail: EmployeeCtx["byEmail"] = new Map();
    for (const row of rows) {
      if (row.employeeNumber) byNumber.set(lower(row.employeeNumber), row);
      if (row.workEmail) byEmail.set(lower(row.workEmail), [...(byEmail.get(lower(row.workEmail)) ?? []), row]);
    }
    return { byNumber, byEmail, departments: new Map(departments.map((d) => [lower(d.name), d])), positions: new Map(positions.map((p) => [lower(p.title), p])), dup: duplicateGuard() };
  },
  check(values, ctx, mode, line) {
    const c = collector();
    const number = clean(values.employeeNumber), email = lower(values.workEmail);
    const byNumber = number ? ctx.byNumber.get(lower(number)) : undefined;
    const byEmail = email ? ctx.byEmail.get(email) ?? [] : [];
    let match: { id: string; firstName: string; lastName: string } | undefined;
    if (mode === "CREATE") {
      if (byNumber) c.errors.push(`Employee number “${number}” already exists (${formatName(byNumber)}).`);
      else if (byEmail.length) c.errors.push(`Work email “${clean(values.workEmail)}” already belongs to ${formatName(byEmail[0]!)}.`);
    } else {
      if (!number && !email) c.errors.push("Update mode needs an employee number or work email on every row.");
      else if (byNumber) {
        match = byNumber;
        if (byEmail.length && !byEmail.some((e) => e.id === byNumber.id)) c.errors.push("The employee number and work email identify different employees.");
      } else if (!number && byEmail.length === 1) match = byEmail[0];
      else if (!number && byEmail.length > 1) c.errors.push(`Work email “${clean(values.workEmail)}” matches ${byEmail.length} employees; use the employee number.`);
      else if (number && byEmail.length) c.errors.push(`Employee number “${number}” is new but the work email already belongs to ${formatName(byEmail[0]!)}.`);
    }
    ctx.dup(number ? `n:${lower(number)}` : "", line, `Employee number “${number}”`, c.errors);
    ctx.dup(email ? `e:${email}` : "", line, `Work email “${clean(values.workEmail)}”`, c.errors);

    const departmentName = clean(values.department), positionName = clean(values.position), supNumber = clean(values.supervisorEmployeeNumber);
    let departmentId = "", positionId = "", supervisorId = "";
    if (departmentName) {
      const found = ctx.departments.get(lower(departmentName));
      if (!found) c.errors.push(`Unknown department “${departmentName}”.`); else { departmentId = found.id; if (!found.active) c.warnings.push(`Department “${departmentName}” is inactive.`); }
    }
    if (positionName) {
      const found = ctx.positions.get(lower(positionName));
      if (!found) c.errors.push(`Unknown position “${positionName}”.`); else { positionId = found.id; if (!found.active) c.warnings.push(`Position “${positionName}” is inactive.`); }
    }
    if (supNumber) {
      const found = ctx.byNumber.get(lower(supNumber));
      if (!found) c.errors.push(`Unknown supervisor employee number “${supNumber}”.`);
      else if (match && found.id === match.id) c.errors.push("An employee cannot supervise themselves.");
      else supervisorId = found.id;
    }
    const status = c.take(parseEnumCell(values.employmentStatus ?? "", EMPLOYMENT, "Employment status", "ACTIVE"));
    const hire = c.take(parseDateCell(values.hireDate ?? "", "Hire date")), sep = c.take(parseDateCell(values.separationDate ?? "", "Separation date"));
    if (hire && sep && sep < hire) c.errors.push("Separation date cannot precede hire date.");
    const merged = {
      employeeNumber: number, firstName: clean(values.firstName) || match?.firstName || "", lastName: clean(values.lastName) || match?.lastName || "",
      middleName: clean(values.middleName), preferredName: clean(values.preferredName), suffix: clean(values.suffix), workEmail: clean(values.workEmail), personalEmail: clean(values.personalEmail),
      workPhone: clean(values.workPhone), mobilePhone: clean(values.mobilePhone), departmentId, positionId, supervisorId, employmentStatus: status ?? "ACTIVE",
      hireDate: hire ?? "", separationDate: sep ?? "", notes: clean(values.notes),
    };
    const parsed = employeeSchema.safeParse(merged);
    if (!parsed.success) c.errors.push(...issue(parsed.error));
    const label = `${[merged.firstName, merged.lastName].filter(Boolean).join(" ") || "(no name)"}${number ? ` (${number})` : ""}`;
    if (c.errors.length || !parsed.success) return failed(label, c.errors, c.warnings);
    return { action: match ? "update" : "create", errors: [], warnings: c.warnings, label, matchId: match?.id, payload: match ? pick(parsed.data, provided(values, employeeKeys)) : parsed.data };
  },
  async write(tx, check, _ctx, who) {
    if (check.matchId) { await tx.employee.update({ where: { id: check.matchId, organizationId: who.organizationId }, data: check.payload as any }); return "updated"; }
    await tx.employee.create({ data: { ...(check.payload as any), organizationId: who.organizationId } });
    return "created";
  },
};

// ---------------------------------------------------------------------------------------------
// Departments / positions
// ---------------------------------------------------------------------------------------------
type NameCtx = { existing: Set<string>; dup: ReturnType<typeof duplicateGuard> };
const simpleNameEntity = (kind: "department" | "position"): EntityDef<NameCtx> => {
  const nameKey = kind === "department" ? "name" : "title";
  return {
    key: kind === "department" ? "departments" : "positions", label: kind === "department" ? "Departments" : "Positions", description: kind === "department" ? "Organizational departments." : "Job positions.",
    guidance: ["Names are unique; existing names are rejected (these types are create-only)."],
    fields: [
      { key: nameKey, label: kind === "department" ? "Name" : "Title", required: true, aliases: kind === "department" ? ["department", "department name"] : ["position", "position title", "job title"], help: "Required, unique.", example: kind === "department" ? "Operations" : "Field Technician" },
      { key: "description", label: "Description", help: "Optional.", example: "" },
      { key: "active", label: "Active", help: "yes/no; default yes.", example: "yes" },
    ],
    async load(organizationId) {
      const rows: Array<{ n: string }> = kind === "department"
        ? (await prisma.department.findMany({ where: { organizationId }, select: { name: true } })).map((r) => ({ n: r.name }))
        : (await prisma.position.findMany({ where: { organizationId }, select: { title: true } })).map((r) => ({ n: r.title }));
      return { existing: new Set(rows.map((r) => lower(r.n))), dup: duplicateGuard() };
    },
    check(values, ctx, _mode, line) {
      const c = collector();
      const name = clean(values[nameKey]);
      if (name && ctx.existing.has(lower(name))) c.errors.push(`“${name}” already exists.`);
      ctx.dup(name ? lower(name) : "", line, `“${name}”`, c.errors);
      const active = c.take(parseBoolCell(values.active ?? "", "Active", true));
      const parsed = (kind === "department" ? departmentSchema : positionSchema).safeParse({ [nameKey]: name, description: clean(values.description), active: active ?? true });
      if (!parsed.success) c.errors.push(...issue(parsed.error));
      if (c.errors.length || !parsed.success) return failed(name || "(blank)", c.errors, c.warnings);
      return { action: "create", errors: [], warnings: [], label: name, payload: parsed.data };
    },
    async write(tx, check, _ctx, who) {
      if (kind === "department") await tx.department.create({ data: { ...(check.payload as any), organizationId: who.organizationId } });
      else await tx.position.create({ data: { ...(check.payload as any), organizationId: who.organizationId } });
      return "created";
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Qualification types
// ---------------------------------------------------------------------------------------------
const qualificationTypes: EntityDef<NameCtx> = {
  key: "qualification-types", label: "Qualification types", description: "Certifications, licenses and other qualification definitions.",
  guidance: ["Names are unique; this type is create-only.", "Calculated expiration needs a validity period in months."],
  fields: [
    { key: "name", label: "Name", required: true, aliases: ["qualification", "qualification name", "type"], help: "Required, unique.", example: "First Aid / CPR" },
    { key: "abbreviation", label: "Abbreviation", help: "Up to 20 characters.", example: "CPR" },
    { key: "description", label: "Description", help: "Optional.", example: "" },
    { key: "category", label: "Category", help: "CERTIFICATION, LICENSE, QUALIFICATION, AUTHORIZATION or INTERNAL (default QUALIFICATION).", example: "CERTIFICATION" },
    { key: "issuingOrganization", label: "Issuing organization", aliases: ["issuer"], help: "Optional.", example: "Red Cross" },
    { key: "expirationBehavior", label: "Expiration behavior", aliases: ["expiration", "expires"], help: "DOES_NOT_EXPIRE, TRACKED or CALCULATED (default DOES_NOT_EXPIRE).", example: "CALCULATED" },
    { key: "defaultValidityMonths", label: "Default validity (months)", aliases: ["validity months", "valid for months"], help: "1–600; required when CALCULATED.", example: "24" },
    { key: "credentialNumberExpected", label: "Credential number expected", help: "yes/no; default no.", example: "no" },
    { key: "documentExpected", label: "Document expected", help: "yes/no; default no.", example: "no" },
    { key: "active", label: "Active", help: "yes/no; default yes.", example: "yes" },
  ],
  async load(organizationId) {
    return { existing: new Set((await prisma.qualificationType.findMany({ where: { organizationId }, select: { name: true } })).map((r) => lower(r.name))), dup: duplicateGuard() };
  },
  check(values, ctx, _mode, line) {
    const c = collector();
    const name = clean(values.name);
    if (name && ctx.existing.has(lower(name))) c.errors.push(`Qualification type “${name}” already exists.`);
    ctx.dup(name ? lower(name) : "", line, `“${name}”`, c.errors);
    const category = c.take(parseEnumCell(values.category ?? "", QUAL_CATEGORY, "Category", "QUALIFICATION"));
    const expiration = c.take(parseEnumCell(values.expirationBehavior ?? "", EXPIRATION, "Expiration behavior", "DOES_NOT_EXPIRE"));
    const months = c.take(parseIntCell(values.defaultValidityMonths ?? "", "Default validity (months)", 1, 600));
    const credential = c.take(parseBoolCell(values.credentialNumberExpected ?? "", "Credential number expected", false));
    const document = c.take(parseBoolCell(values.documentExpected ?? "", "Document expected", false));
    const active = c.take(parseBoolCell(values.active ?? "", "Active", true));
    const parsed = qualificationTypeSchema.safeParse({
      name, abbreviation: clean(values.abbreviation), description: clean(values.description), category: category ?? "QUALIFICATION", issuingOrganization: clean(values.issuingOrganization),
      expirationBehavior: expiration ?? "DOES_NOT_EXPIRE", defaultValidityMonths: months === null ? "" : String(months), credentialNumberExpected: credential ?? false, documentExpected: document ?? false, active: active ?? true,
    });
    if (!parsed.success) c.errors.push(...issue(parsed.error));
    if (c.errors.length || !parsed.success) return failed(name || "(blank)", c.errors, c.warnings);
    return { action: "create", errors: [], warnings: [], label: name, payload: parsed.data };
  },
  async write(tx, check, _ctx, who) { await tx.qualificationType.create({ data: { ...(check.payload as any), organizationId: who.organizationId } }); return "created"; },
};

// ---------------------------------------------------------------------------------------------
// Employee qualifications
// ---------------------------------------------------------------------------------------------
type EmpQualCtx = {
  byNumber: Map<string, string>; byEmail: Map<string, string[]>;
  types: Map<string, { id: string; active: boolean; expirationBehavior: string; defaultValidityMonths: number | null }>;
  existing: Set<string>; dup: ReturnType<typeof duplicateGuard>;
};
const employeeQualifications: EntityDef<EmpQualCtx> = {
  key: "employee-qualifications", label: "Employee qualifications", description: "Credentials held by existing employees; imported as unverified.",
  guidance: ["Identify the employee by employee number (or a unique work email) and the qualification type by its exact name.", "Records are created as UNVERIFIED and still go through the normal verification workflow.", "A record for the same employee, type and credential number (or issue date) is treated as a duplicate."],
  fields: [
    { key: "employeeNumber", label: "Employee number", aliases: ["employee id", "employee #", "emp no"], help: "Identifies the employee.", example: "E-1001" },
    { key: "workEmail", label: "Work email", aliases: ["email"], help: "Used when no employee number is given.", example: "" },
    { key: "qualificationType", label: "Qualification type", required: true, aliases: ["qualification", "certification", "type"], help: "Existing qualification type name.", example: "First Aid / CPR" },
    { key: "credentialNumber", label: "Credential number", aliases: ["license number", "certificate number", "number"], help: "Optional.", example: "CPR-88231" },
    { key: "issuingOrganization", label: "Issuing organization", aliases: ["issuer"], help: "Optional.", example: "Red Cross" },
    { key: "issueDate", label: "Issue date", aliases: ["issued", "date issued"], help: "YYYY-MM-DD.", example: "2025-01-15" },
    { key: "expirationDate", label: "Expiration date", aliases: ["expires", "expiry", "expiry date"], help: "YYYY-MM-DD; ignored for types that never expire (a warning is shown).", example: "2027-01-15" },
    { key: "notes", label: "Notes", help: "Optional.", example: "" },
  ],
  async load(organizationId) {
    const [employees, types, existing] = await Promise.all([
      prisma.employee.findMany({ where: { organizationId }, select: { id: true, employeeNumber: true, workEmail: true } }),
      prisma.qualificationType.findMany({ where: { organizationId }, select: { id: true, name: true, active: true, expirationBehavior: true, defaultValidityMonths: true } }),
      prisma.employeeQualification.findMany({ where: { organizationId, archivedAt: null }, select: { employeeId: true, qualificationTypeId: true, credentialNumber: true, issueDate: true } }),
    ]);
    const byEmail = new Map<string, string[]>();
    for (const e of employees) if (e.workEmail) byEmail.set(lower(e.workEmail), [...(byEmail.get(lower(e.workEmail)) ?? []), e.id]);
    return {
      byNumber: new Map(employees.filter((e) => e.employeeNumber).map((e) => [lower(e.employeeNumber), e.id])), byEmail,
      types: new Map(types.map((t) => [lower(t.name), t])),
      existing: new Set(existing.map((q) => `${q.employeeId}|${q.qualificationTypeId}|${lower(q.credentialNumber) || q.issueDate?.toISOString().slice(0, 10) || ""}`)), dup: duplicateGuard(),
    };
  },
  check(values, ctx, _mode, line) {
    const c = collector();
    const number = clean(values.employeeNumber), email = lower(values.workEmail);
    let employeeId = "";
    if (!number && !email) c.errors.push("Employee number or work email is required.");
    else if (number) { employeeId = ctx.byNumber.get(lower(number)) ?? ""; if (!employeeId) c.errors.push(`Unknown employee number “${number}”.`); }
    else { const hits = ctx.byEmail.get(email) ?? []; if (hits.length === 1) employeeId = hits[0]!; else c.errors.push(hits.length ? `Work email “${clean(values.workEmail)}” matches ${hits.length} employees; use the employee number.` : `Unknown work email “${clean(values.workEmail)}”.`); }
    const typeName = clean(values.qualificationType);
    const type = typeName ? ctx.types.get(lower(typeName)) : undefined;
    if (!typeName) c.errors.push("Qualification type is required.");
    else if (!type) c.errors.push(`Unknown qualification type “${typeName}”.`);
    else if (!type.active) c.warnings.push(`Qualification type “${typeName}” is inactive.`);
    const issue_ = c.take(parseDateCell(values.issueDate ?? "", "Issue date")), expiry = c.take(parseDateCell(values.expirationDate ?? "", "Expiration date"));
    let expirationDate = expiry;
    if (type?.expirationBehavior === "DOES_NOT_EXPIRE") { if (expiry) c.warnings.push("This type does not expire; the expiration date will be ignored."); expirationDate = null; }
    if (type?.expirationBehavior === "CALCULATED") {
      if (!issue_ || !type.defaultValidityMonths) c.errors.push("An issue date is required to calculate expiration for this type.");
      else expirationDate = calculateExpirationDate(new Date(`${issue_}T00:00:00.000Z`), type.defaultValidityMonths).toISOString().slice(0, 10);
    }
    if (type?.expirationBehavior === "TRACKED" && !expirationDate) c.warnings.push("This type tracks expiration but no expiration date was given.");
    const credential = clean(values.credentialNumber);
    const key = `${employeeId}|${type?.id}|${lower(credential) || issue_ || ""}`;
    if (employeeId && type && ctx.existing.has(key)) c.errors.push("A matching qualification record already exists for this employee.");
    ctx.dup(employeeId && type ? key : "", line, "This employee/qualification/credential combination", c.errors);
    const label = `${typeName || "(no type)"} for ${number || clean(values.workEmail) || "(no employee)"}`;
    if (issue_ && expirationDate && expirationDate < issue_) c.errors.push("Expiration cannot precede issue date.");
    if (c.errors.length || !type) return failed(label, c.errors, c.warnings);
    return {
      action: "create", errors: [], warnings: c.warnings, label,
      payload: { employeeId, qualificationTypeId: type.id, credentialNumber: credential || null, issuingOrganization: clean(values.issuingOrganization) || null, issueDate: issue_ ? new Date(`${issue_}T00:00:00.000Z`) : null, expirationDate: expirationDate ? new Date(`${expirationDate}T00:00:00.000Z`) : null, notes: clean(values.notes) || null },
    };
  },
  async write(tx, check, _ctx, who) { await tx.employeeQualification.create({ data: { ...(check.payload as any), organizationId: who.organizationId, verificationStatus: "UNVERIFIED" } }); return "created"; },
};

// ---------------------------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------------------------
type ClientCtx = { byNumber: Map<string, { id: string; name: string }>; names: Map<string, string>; dup: ReturnType<typeof duplicateGuard>; seenNames: Map<string, number>; autoNumber: boolean };
const clientKeys = { name: "name", displayName: "displayName", clientNumber: "clientNumber", status: "status", type: "type", website: "website", mainPhone: "mainPhone", generalEmail: "generalEmail", addressLine1: "addressLine1", addressLine2: "addressLine2", city: "city", stateProvince: "stateProvince", postalCode: "postalCode", country: "country", notes: "notes" };
const clients: EntityDef<ClientCtx> = {
  key: "clients", label: "Clients", description: "Client organizations and individuals.",
  updateIdentity: "Client number.",
  guidance: ["Duplicate client numbers are rejected. A client with the same name as an existing one is imported with a warning (names are not unique).", "Blank client numbers are generated when auto-assign is enabled under Settings → Numbering.", "Update mode matches only on client number and leaves blank cells unchanged."],
  fields: [
    { key: "name", label: "Name", required: true, aliases: ["client", "client name", "company", "company name", "organization"], help: "Required.", example: "Harbor Logistics LLC" },
    { key: "displayName", label: "Display name", aliases: ["short name", "dba"], help: "Optional.", example: "Harbor Logistics" },
    { key: "clientNumber", label: "Client number", aliases: ["client id", "client #", "account number", "customer number"], help: "Unique identifier.", example: "C-0001" },
    { key: "status", label: "Status", help: "PROSPECT, ACTIVE, INACTIVE or ARCHIVED (default ACTIVE).", example: "ACTIVE" },
    { key: "type", label: "Type", aliases: ["client type"], help: "BUSINESS, GOVERNMENT, NONPROFIT, INDIVIDUAL or OTHER.", example: "BUSINESS" },
    { key: "website", label: "Website", help: "Optional.", example: "https://example.com" },
    { key: "mainPhone", label: "Main phone", aliases: ["phone"], help: "Optional.", example: "555-0123" },
    { key: "generalEmail", label: "General email", aliases: ["email"], help: "Must be a valid address.", example: "info@example.com" },
    { key: "addressLine1", label: "Address line 1", aliases: ["address", "street"], help: "Optional.", example: "100 Main St" },
    { key: "addressLine2", label: "Address line 2", help: "Optional.", example: "" },
    { key: "city", label: "City", help: "Optional.", example: "Portland" },
    { key: "stateProvince", label: "State / province", aliases: ["state", "province"], help: "Optional.", example: "OR" },
    { key: "postalCode", label: "Postal code", aliases: ["zip", "zip code"], help: "Optional.", example: "97201" },
    { key: "country", label: "Country", help: "Optional.", example: "USA" },
    { key: "notes", label: "Notes", help: "Optional.", example: "" },
  ],
  async load(organizationId) {
    const [rows, autoNumber] = await Promise.all([
      prisma.client.findMany({ where: { organizationId }, select: { id: true, name: true, clientNumber: true } }),
      prisma.$transaction((tx) => shouldAutoAssign(tx, organizationId, "CLIENT")),
    ]);
    return { byNumber: new Map(rows.filter((r) => r.clientNumber).map((r) => [lower(r.clientNumber), r])), names: new Map(rows.map((r) => [lower(r.name), r.id])), dup: duplicateGuard(), seenNames: new Map(), autoNumber };
  },
  check(values, ctx, mode, line) {
    const c = collector();
    const number = clean(values.clientNumber), name = clean(values.name);
    const match = number ? ctx.byNumber.get(lower(number)) : undefined;
    if (mode === "CREATE" && match) c.errors.push(`Client number “${number}” already exists (${match.name}).`);
    if (mode === "UPDATE" && !number) c.errors.push("Update mode needs a client number on every row.");
    ctx.dup(number ? lower(number) : "", line, `Client number “${number}”`, c.errors);
    const existingName = name ? ctx.names.get(lower(name)) : undefined;
    if (name && existingName && existingName !== match?.id) c.warnings.push(`A client named “${name}” already exists; this may be a duplicate.`);
    const firstSeen = name ? ctx.seenNames.get(lower(name)) : undefined;
    if (firstSeen !== undefined) c.warnings.push(`The name “${name}” also appears on line ${firstSeen}.`); else if (name) ctx.seenNames.set(lower(name), line);
    const status = c.take(parseEnumCell(values.status ?? "", CLIENT_STATUS, "Status", "ACTIVE"));
    const type = c.take(parseEnumCell(values.type ?? "", CLIENT_TYPE, "Type"));
    if (!number && !match && !ctx.autoNumber && mode === "CREATE") c.warnings.push("No client number; the client will be created without one.");
    const parsed = clientSchema.safeParse({ ...Object.fromEntries(Object.keys(clientKeys).map((k) => [k, clean(values[k])])), name: name || match?.name || "", status: status ?? "ACTIVE", type: type ?? undefined });
    if (!parsed.success) c.errors.push(...issue(parsed.error));
    const label = `${name || match?.name || "(no name)"}${number ? ` (${number})` : ""}`;
    if (c.errors.length || !parsed.success) return failed(label, c.errors, c.warnings);
    const row: RowCheck = { action: match ? "update" : "create", errors: [], warnings: c.warnings, label, matchId: match?.id, payload: match ? pick(parsed.data, provided(values, clientKeys)) : parsed.data };
    return row;
  },
  async write(tx, check, _ctx, who) {
    if (check.matchId) { await tx.client.update({ where: { id: check.matchId, organizationId: who.organizationId }, data: check.payload as any }); return "updated"; }
    const data = { ...(check.payload as any) };
    if (!data.clientNumber && await shouldAutoAssign(tx, who.organizationId, "CLIENT")) data.clientNumber = await allocateNumber(tx, who.organizationId, "CLIENT", async (n) => Boolean(await tx.client.findFirst({ where: { organizationId: who.organizationId, clientNumber: n }, select: { id: true } })));
    await tx.client.create({ data: { ...data, organizationId: who.organizationId, createdByUserId: who.userId } });
    return "created";
  },
};

// ---------------------------------------------------------------------------------------------
// Client contacts
// ---------------------------------------------------------------------------------------------
type ContactCtx = { byNumber: Map<string, string>; byName: Map<string, string[]>; existing: Set<string>; dup: ReturnType<typeof duplicateGuard> };
const clientContacts: EntityDef<ContactCtx> = {
  key: "client-contacts", label: "Client contacts", description: "Contacts belonging to existing clients.",
  guidance: ["Identify the client by client number, or by exact client name when that name is unique.", "A contact with the same email (or, without an email, the same name) for the same client is rejected as a duplicate.", "Create-only."],
  fields: [
    { key: "clientNumber", label: "Client number", aliases: ["client id", "client #", "account number"], help: "Identifies the client.", example: "C-0001" },
    { key: "clientName", label: "Client name", aliases: ["client", "company"], help: "Used when no client number is given.", example: "" },
    { key: "firstName", label: "First name", required: true, aliases: ["given name", "first"], help: "Required.", example: "Sam" },
    { key: "lastName", label: "Last name", required: true, aliases: ["surname", "last"], help: "Required.", example: "Chen" },
    { key: "title", label: "Title", aliases: ["job title", "role"], help: "Optional.", example: "Operations Manager" },
    { key: "email", label: "Email", aliases: ["email address"], help: "Valid address.", example: "sam.chen@example.com" },
    { key: "phone", label: "Phone", help: "Optional.", example: "555-0124" },
    { key: "mobilePhone", label: "Mobile phone", aliases: ["cell", "mobile"], help: "Optional.", example: "" },
    { key: "preferredContactMethod", label: "Preferred contact method", help: "EMAIL, PHONE or MOBILE.", example: "EMAIL" },
    { key: "primary", label: "Primary contact", help: "yes/no; default no.", example: "yes" },
    { key: "active", label: "Active", help: "yes/no; default yes.", example: "yes" },
    { key: "notes", label: "Notes", help: "Optional.", example: "" },
  ],
  async load(organizationId) {
    const [clientRows, contacts] = await Promise.all([
      prisma.client.findMany({ where: { organizationId }, select: { id: true, name: true, clientNumber: true } }),
      prisma.clientContact.findMany({ where: { organizationId }, select: { clientId: true, email: true, firstName: true, lastName: true } }),
    ]);
    const byName = new Map<string, string[]>();
    for (const row of clientRows) byName.set(lower(row.name), [...(byName.get(lower(row.name)) ?? []), row.id]);
    return {
      byNumber: new Map(clientRows.filter((r) => r.clientNumber).map((r) => [lower(r.clientNumber), r.id])), byName,
      existing: new Set(contacts.map((r) => `${r.clientId}|${lower(r.email) || `${lower(r.firstName)} ${lower(r.lastName)}`}`)), dup: duplicateGuard(),
    };
  },
  check(values, ctx, _mode, line) {
    const c = collector();
    const number = clean(values.clientNumber), name = clean(values.clientName);
    let clientId = "";
    if (!number && !name) c.errors.push("Client number or client name is required.");
    else if (number) { clientId = ctx.byNumber.get(lower(number)) ?? ""; if (!clientId) c.errors.push(`Unknown client number “${number}”.`); }
    else { const hits = ctx.byName.get(lower(name)) ?? []; if (hits.length === 1) clientId = hits[0]!; else c.errors.push(hits.length ? `Client name “${name}” matches ${hits.length} clients; use the client number.` : `Unknown client “${name}”.`); }
    const method = c.take(parseEnumCell(values.preferredContactMethod ?? "", CONTACT_METHOD, "Preferred contact method"));
    const primary = c.take(parseBoolCell(values.primary ?? "", "Primary contact", false)), active = c.take(parseBoolCell(values.active ?? "", "Active", true));
    const parsed = contactSchema.safeParse({ firstName: clean(values.firstName), lastName: clean(values.lastName), title: clean(values.title), email: clean(values.email), phone: clean(values.phone), mobilePhone: clean(values.mobilePhone), preferredContactMethod: method ?? undefined, primary: primary ?? false, active: active ?? true, notes: clean(values.notes) });
    if (!parsed.success) c.errors.push(...issue(parsed.error));
    const identity = lower(values.email) || `${lower(values.firstName)} ${lower(values.lastName)}`;
    if (clientId && ctx.existing.has(`${clientId}|${identity}`)) c.errors.push("This contact already exists for the client.");
    ctx.dup(clientId ? `${clientId}|${identity}` : "", line, "This contact", c.errors);
    const label = `${clean(values.firstName)} ${clean(values.lastName)} — ${number || name || "(no client)"}`.trim();
    if (c.errors.length || !parsed.success) return failed(label, c.errors, c.warnings);
    return { action: "create", errors: [], warnings: c.warnings, label, payload: { ...parsed.data, clientId } };
  },
  async write(tx, check, _ctx, who) {
    const data = check.payload as any;
    const created = await tx.clientContact.create({ data: { ...data, organizationId: who.organizationId } });
    if (data.primary) {
      await tx.clientContact.updateMany({ where: { clientId: data.clientId, organizationId: who.organizationId, id: { not: created.id } }, data: { primary: false } });
      await tx.client.update({ where: { id: data.clientId, organizationId: who.organizationId }, data: { primaryContactId: created.id } });
    }
    return "created";
  },
};

// ---------------------------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------------------------
type EquipmentCtx = { byAsset: Map<string, { id: string; name: string }>; categories: Map<string, string>; locations: Map<string, string>; dup: ReturnType<typeof duplicateGuard>; autoNumber: boolean };
const equipmentKeys = { assetNumber: "assetNumber", name: "name", description: "description", category: "categoryId", location: "locationId", manufacturer: "manufacturer", model: "model", serialNumber: "serialNumber", status: "status", condition: "condition", purchaseDate: "purchaseDate", purchaseCost: "purchaseCost", replacementValue: "replacementValue", defaultRentalRate: "defaultRentalRate", rateUnit: "rateUnit", rentable: "rentable", active: "active", notes: "notes" };
const equipment: EntityDef<EquipmentCtx> = {
  key: "equipment", label: "Equipment", description: "Rentable and non-rentable assets.",
  updateIdentity: "Asset number.",
  guidance: ["Categories and locations must already exist (matched by name); unknown names are rejected.", "Blank asset numbers are generated on create when auto-assign is enabled under Settings → Numbering.", "Status defaults to AVAILABLE, condition to GOOD, rentable to no and active to yes.", "Update mode matches only on asset number and leaves blank cells unchanged."],
  fields: [
    { key: "assetNumber", label: "Asset number", required: true, aliases: ["asset id", "asset #", "asset tag", "tag number"], help: "Unique identifier.", example: "EQ-0001" },
    { key: "name", label: "Name", required: true, aliases: ["equipment", "equipment name", "item", "description of item"], help: "Required.", example: "Generator 5kW" },
    { key: "description", label: "Description", help: "Optional.", example: "" },
    { key: "category", label: "Category", help: "Existing category name.", example: "Power" },
    { key: "location", label: "Location", help: "Existing location name.", example: "Main warehouse" },
    { key: "manufacturer", label: "Manufacturer", aliases: ["make", "brand"], help: "Optional.", example: "Honda" },
    { key: "model", label: "Model", help: "Optional.", example: "EU5000" },
    { key: "serialNumber", label: "Serial number", aliases: ["serial", "serial #", "s/n"], help: "Optional.", example: "SN-12345" },
    { key: "status", label: "Status", help: "AVAILABLE, RESERVED, PREPARING, CHECKED_OUT, INSPECTION, MAINTENANCE, OUT_OF_SERVICE or LOST.", example: "AVAILABLE" },
    { key: "condition", label: "Condition", help: "NEW, EXCELLENT, GOOD, FAIR, POOR or DAMAGED.", example: "GOOD" },
    { key: "purchaseDate", label: "Purchase date", aliases: ["date purchased", "acquired"], help: "YYYY-MM-DD.", example: "2024-06-01" },
    { key: "purchaseCost", label: "Purchase cost", aliases: ["cost", "price"], help: "Non-negative amount.", example: "1899.00" },
    { key: "replacementValue", label: "Replacement value", help: "Non-negative amount.", example: "2200.00" },
    { key: "defaultRentalRate", label: "Default rental rate", aliases: ["rental rate", "rate"], help: "Non-negative amount.", example: "75.00" },
    { key: "rateUnit", label: "Rate unit", help: "FLAT, DAILY or WEEKLY.", example: "DAILY" },
    { key: "rentable", label: "Rentable", help: "yes/no; default no.", example: "yes" },
    { key: "active", label: "Active", help: "yes/no; default yes.", example: "yes" },
    { key: "notes", label: "Notes", help: "Optional.", example: "" },
  ],
  async load(organizationId) {
    const [rows, categories, locations, autoNumber] = await Promise.all([
      prisma.equipment.findMany({ where: { organizationId }, select: { id: true, name: true, assetNumber: true } }),
      prisma.equipmentCategory.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      prisma.equipmentLocation.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      prisma.$transaction((tx) => shouldAutoAssign(tx, organizationId, "EQUIPMENT")),
    ]);
    return { byAsset: new Map(rows.map((r) => [lower(r.assetNumber), r])), categories: new Map(categories.map((r) => [lower(r.name), r.id])), locations: new Map(locations.map((r) => [lower(r.name), r.id])), dup: duplicateGuard(), autoNumber };
  },
  check(values, ctx, mode, line) {
    const c = collector();
    const asset = clean(values.assetNumber), name = clean(values.name);
    const match = asset ? ctx.byAsset.get(lower(asset)) : undefined;
    if (!asset && (mode === "UPDATE" || !ctx.autoNumber)) c.errors.push(mode === "UPDATE" ? "Update mode needs an asset number on every row." : "Asset number is required (auto-assign is off).");
    if (mode === "CREATE" && match) c.errors.push(`Asset number “${asset}” already exists (${match.name}).`);
    ctx.dup(asset ? lower(asset) : "", line, `Asset number “${asset}”`, c.errors);
    if (!name && !match) c.errors.push("Name is required.");
    let categoryId: string | undefined, locationId: string | undefined;
    if (clean(values.category)) { categoryId = ctx.categories.get(lower(values.category)); if (!categoryId) c.errors.push(`Unknown category “${clean(values.category)}”.`); }
    if (clean(values.location)) { locationId = ctx.locations.get(lower(values.location)); if (!locationId) c.errors.push(`Unknown location “${clean(values.location)}”.`); }
    const status = c.take(parseEnumCell(values.status ?? "", EQUIP_STATUS, "Status", "AVAILABLE")), condition = c.take(parseEnumCell(values.condition ?? "", EQUIP_CONDITION, "Condition", "GOOD"));
    const unit = c.take(parseEnumCell(values.rateUnit ?? "", RATE_UNIT, "Rate unit"));
    const purchaseDate = c.take(parseDateCell(values.purchaseDate ?? "", "Purchase date"));
    const cost = c.take(parseDecimalCell(values.purchaseCost ?? "", "Purchase cost")), value = c.take(parseDecimalCell(values.replacementValue ?? "", "Replacement value")), rate = c.take(parseDecimalCell(values.defaultRentalRate ?? "", "Default rental rate"));
    const rentable = c.take(parseBoolCell(values.rentable ?? "", "Rentable", false)), active = c.take(parseBoolCell(values.active ?? "", "Active", true));
    if (rate && !unit) c.warnings.push("A rental rate was given without a rate unit.");
    if (rentable && status && !["AVAILABLE", "RESERVED"].includes(status) && mode === "CREATE") c.warnings.push(`Rentable equipment starts in status ${status}.`);
    const label = `${asset || "(auto)"} — ${name || match?.name || "(no name)"}`;
    if (c.errors.length) return failed(label, c.errors, c.warnings);
    const payload = {
      assetNumber: asset, name: name || match?.name, description: clean(values.description) || null, categoryId: categoryId ?? null, locationId: locationId ?? null, manufacturer: clean(values.manufacturer) || null, model: clean(values.model) || null,
      serialNumber: clean(values.serialNumber) || null, status, condition, purchaseDate: purchaseDate ? new Date(`${purchaseDate}T00:00:00.000Z`) : null, purchaseCost: cost, replacementValue: value, defaultRentalRate: rate, rateUnit: unit, rentable, active, notes: clean(values.notes) || null,
    };
    return { action: match ? "update" : "create", errors: [], warnings: c.warnings, label, matchId: match?.id, payload: match ? pick(payload, provided(values, equipmentKeys)) : payload };
  },
  async write(tx, check, _ctx, who) {
    if (check.matchId) { await tx.equipment.update({ where: { id: check.matchId, organizationId: who.organizationId }, data: check.payload as any }); return "updated"; }
    const data = { ...(check.payload as any) };
    if (!data.assetNumber) data.assetNumber = await allocateNumber(tx, who.organizationId, "EQUIPMENT", async (n) => Boolean(await tx.equipment.findFirst({ where: { organizationId: who.organizationId, assetNumber: n }, select: { id: true } })));
    await tx.equipment.create({ data: { ...data, organizationId: who.organizationId } });
    return "created";
  },
};

// ---------------------------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------------------------
type ProjectCtx = { numbers: Set<string>; names: Set<string>; employees: Map<string, string>; clientNumber: Map<string, string>; clientName: Map<string, string[]>; dup: ReturnType<typeof duplicateGuard>; seenNames: Map<string, number> };
const projects: EntityDef<ProjectCtx> = {
  key: "projects", label: "Projects", description: "Projects, optionally linked to an existing client and manager.",
  guidance: ["The project manager is an existing employee's employee number; the client is an existing client's number (or a unique exact name).", "Duplicate project numbers are rejected; a duplicate project name only warns.", "Blank project numbers are generated when auto-assign is enabled under Settings → Numbering.", "Create-only. Completed projects need an actual end date."],
  fields: [
    { key: "projectNumber", label: "Project number", aliases: ["project id", "project #", "job number"], help: "Unique identifier.", example: "P-0001" },
    { key: "name", label: "Name", required: true, aliases: ["project", "project name", "title"], help: "Required.", example: "Warehouse refit" },
    { key: "description", label: "Description", help: "Optional.", example: "" },
    { key: "status", label: "Status", help: "PLANNING, ACTIVE, ON_HOLD, COMPLETED, CANCELLED or ARCHIVED (default PLANNING).", example: "PLANNING" },
    { key: "priority", label: "Priority", help: "LOW, NORMAL, HIGH or URGENT (default NORMAL).", example: "NORMAL" },
    { key: "projectManager", label: "Project manager (employee number)", aliases: ["manager", "project manager", "pm"], help: "Existing employee number.", example: "E-1001" },
    { key: "client", label: "Client (number or name)", aliases: ["client number", "client name", "customer"], help: "Existing client.", example: "C-0001" },
    { key: "location", label: "Location", help: "Optional.", example: "" },
    { key: "startDate", label: "Start date", help: "YYYY-MM-DD.", example: "2026-11-01" },
    { key: "targetEndDate", label: "Target end date", aliases: ["end date", "due date"], help: "YYYY-MM-DD.", example: "2026-12-15" },
    { key: "actualEndDate", label: "Actual end date", help: "YYYY-MM-DD.", example: "" },
    { key: "notes", label: "Notes", help: "Optional.", example: "" },
  ],
  async load(organizationId) {
    const [rows, employees, clientRows] = await Promise.all([
      prisma.project.findMany({ where: { organizationId }, select: { name: true, projectNumber: true } }),
      prisma.employee.findMany({ where: { organizationId, employeeNumber: { not: null } }, select: { id: true, employeeNumber: true } }),
      prisma.client.findMany({ where: { organizationId }, select: { id: true, name: true, clientNumber: true } }),
    ]);
    const clientName = new Map<string, string[]>();
    for (const row of clientRows) clientName.set(lower(row.name), [...(clientName.get(lower(row.name)) ?? []), row.id]);
    return {
      numbers: new Set(rows.filter((r) => r.projectNumber).map((r) => lower(r.projectNumber))), names: new Set(rows.map((r) => lower(r.name))),
      employees: new Map(employees.map((e) => [lower(e.employeeNumber), e.id])), clientNumber: new Map(clientRows.filter((r) => r.clientNumber).map((r) => [lower(r.clientNumber), r.id])), clientName, dup: duplicateGuard(), seenNames: new Map(),
    };
  },
  check(values, ctx, _mode, line) {
    const c = collector();
    const number = clean(values.projectNumber), name = clean(values.name);
    if (number && ctx.numbers.has(lower(number))) c.errors.push(`Project number “${number}” already exists.`);
    ctx.dup(number ? lower(number) : "", line, `Project number “${number}”`, c.errors);
    if (name && ctx.names.has(lower(name))) c.warnings.push(`A project named “${name}” already exists.`);
    const seen = name ? ctx.seenNames.get(lower(name)) : undefined;
    if (seen !== undefined) c.warnings.push(`The name “${name}” also appears on line ${seen}.`); else if (name) ctx.seenNames.set(lower(name), line);
    let projectManagerId = "", clientId = "";
    const manager = clean(values.projectManager);
    if (manager) { projectManagerId = ctx.employees.get(lower(manager)) ?? ""; if (!projectManagerId) c.errors.push(`Unknown project manager employee number “${manager}”.`); }
    const client = clean(values.client);
    if (client) {
      clientId = ctx.clientNumber.get(lower(client)) ?? "";
      if (!clientId) { const hits = ctx.clientName.get(lower(client)) ?? []; if (hits.length === 1) clientId = hits[0]!; else c.errors.push(hits.length ? `Client “${client}” matches ${hits.length} clients; use the client number.` : `Unknown client “${client}”.`); }
    }
    const status = c.take(parseEnumCell(values.status ?? "", PROJECT_STATUS, "Status", "PLANNING")), priority = c.take(parseEnumCell(values.priority ?? "", PROJECT_PRIORITY, "Priority", "NORMAL"));
    const start = c.take(parseDateCell(values.startDate ?? "", "Start date")), target = c.take(parseDateCell(values.targetEndDate ?? "", "Target end date")), actual = c.take(parseDateCell(values.actualEndDate ?? "", "Actual end date"));
    const parsed = projectSchema.safeParse({ name, projectNumber: number, description: clean(values.description), status: status ?? "PLANNING", priority: priority ?? "NORMAL", projectManagerId, clientId, location: clean(values.location), startDate: start ?? "", targetEndDate: target ?? "", actualEndDate: actual ?? "", notes: clean(values.notes), portalVisible: false });
    if (!parsed.success) c.errors.push(...issue(parsed.error));
    const label = `${name || "(no name)"}${number ? ` (${number})` : ""}`;
    if (c.errors.length || !parsed.success) return failed(label, c.errors, c.warnings);
    return { action: "create", errors: [], warnings: c.warnings, label, payload: parsed.data };
  },
  async write(tx, check, _ctx, who) {
    const data = { ...(check.payload as any) };
    if (!data.projectNumber && await shouldAutoAssign(tx, who.organizationId, "PROJECT")) data.projectNumber = await allocateNumber(tx, who.organizationId, "PROJECT", async (n) => Boolean(await tx.project.findFirst({ where: { organizationId: who.organizationId, projectNumber: n }, select: { id: true } })));
    await tx.project.create({ data: { ...data, organizationId: who.organizationId, activities: { create: { organizationId: who.organizationId, type: "SYSTEM", content: "Project created by import." } } } });
    return "created";
  },
};

export const ENTITY_DEFS: Record<ImportEntity, EntityDef<any>> = {
  employees, departments: simpleNameEntity("department"), positions: simpleNameEntity("position"), "qualification-types": qualificationTypes,
  "employee-qualifications": employeeQualifications, clients, "client-contacts": clientContacts, equipment, projects,
};
