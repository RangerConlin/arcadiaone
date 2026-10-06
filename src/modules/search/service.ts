/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { formatName } from "@/lib/format";
import { clientVisibilityWhere } from "@/modules/clients/authorization";
import { documentVisibilityWhere } from "@/modules/documents/authorization";
import { invoiceVisibilityWhere } from "@/modules/invoices/authorization";
import { projectVisibilityWhere } from "@/modules/projects/authorization";
import { taskVisibilityWhere } from "@/modules/tasks/authorization";

/**
 * Global search. Every entity is queried in PostgreSQL with the owning module's own visibility
 * predicate AND-ed into the WHERE clause, so a row the viewer cannot open directly is never read,
 * counted, ranked or returned. Nothing is fetched and filtered afterwards. Matching is
 * case-insensitive substring (served by the pg_trgm GIN indexes); exact matches on human-readable
 * numbers and names are listed first.
 */
export type SearchEntity =
  | "employees" | "qualifications" | "projects" | "tasks" | "clients" | "contacts" | "equipment"
  | "rentals" | "documents" | "invoices" | "courses" | "maintenance";

export type SearchHit = { entity: SearchEntity; id: string; title: string; subtitle: string; href: string; exact: boolean };
export type SearchGroup = { entity: SearchEntity; label: string; hits: SearchHit[]; total: number };

type Where = Record<string, unknown>;
type Def = {
  label: string;
  delegate: string;
  /** The module's own visibility predicate, or null when this viewer may not search the entity at all. */
  access: (user: AuthenticatedUser) => Where | null;
  /** One OR-branch list for a single search term (substring). */
  match: (term: string) => Where[];
  /** OR-branches for an exact (case-insensitive) match on the whole query. */
  exact: (query: string) => Where[];
  include?: Where;
  orderBy: Where[];
  toHit: (row: any) => Omit<SearchHit, "entity" | "exact">;
};

/** LIKE wildcards in what the user typed must match literally. */
const likeLiteral = (term: string) => term.replace(/[\\%_]/g, (char) => `\\${char}`);
const ci = (path: string, term: string): Where => {
  const parts = path.split(".");
  const leaf: Where = { [parts.at(-1)!]: { contains: likeLiteral(term), mode: "insensitive" } };
  return parts.slice(0, -1).reduceRight<Where>((inner, key) => ({ [key]: inner }), leaf);
};
const eq = (path: string, value: string): Where => {
  const parts = path.split(".");
  const leaf: Where = { [parts.at(-1)!]: { equals: value, mode: "insensitive" } };
  return parts.slice(0, -1).reduceRight<Where>((inner, key) => ({ [key]: inner }), leaf);
};
const fields = (paths: string[]) => (term: string) => paths.map((path) => ci(path, term));
const exactOn = (paths: string[]) => (query: string) => paths.map((path) => eq(path, query));
const dot = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join(" · ");
const day = (date: Date | null | undefined) => (date ? date.toISOString().slice(0, 10) : null);
const label = (value: string | null | undefined) => (value ? value.toLowerCase().replaceAll("_", " ") : null);
const personName = (employee: { firstName: string; preferredName?: string | null; lastName: string; suffix?: string | null } | null | undefined) => (employee ? formatName(employee) : null);

const DEFS: Record<SearchEntity, Def> = {
  employees: {
    label: "Employees", delegate: "employee",
    // Managers and admins browse the directory; an employee can only ever see their own profile.
    access: (u) => (u.role === "EMPLOYEE" ? (u.employeeId ? { organizationId: u.organizationId, id: u.employeeId } : null) : { organizationId: u.organizationId }),
    match: fields(["firstName", "lastName", "preferredName", "employeeNumber", "workEmail"]),
    exact: exactOn(["employeeNumber", "workEmail"]),
    include: { department: { select: { name: true } }, position: { select: { title: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    toHit: (e) => ({ id: e.id, title: formatName(e), subtitle: dot(e.employeeNumber, e.position?.title, e.department?.name, e.employmentStatus !== "ACTIVE" && label(e.employmentStatus)), href: `/people/${e.id}` }),
  },
  qualifications: {
    label: "Qualifications", delegate: "employeeQualification",
    access: (u) => (u.role === "EMPLOYEE" ? (u.employeeId ? { organizationId: u.organizationId, archivedAt: null, employeeId: u.employeeId } : null) : { organizationId: u.organizationId, archivedAt: null }),
    match: fields(["qualificationType.name", "credentialNumber", "employee.firstName", "employee.lastName", "employee.employeeNumber"]),
    exact: exactOn(["credentialNumber", "qualificationType.name"]),
    include: { qualificationType: { select: { name: true } }, employee: { select: { firstName: true, preferredName: true, lastName: true, suffix: true } } },
    orderBy: [{ expirationDate: "asc" }, { id: "asc" }],
    toHit: (q) => ({ id: q.id, title: q.qualificationType.name, subtitle: dot(personName(q.employee), label(q.verificationStatus), q.expirationDate && `expires ${day(q.expirationDate)}`), href: `/people/${q.employeeId}` }),
  },
  projects: {
    label: "Projects", delegate: "project",
    access: (u) => projectVisibilityWhere(u) as Where,
    match: fields(["name", "projectNumber", "clientName", "client.name"]),
    exact: exactOn(["projectNumber", "name"]),
    include: { client: { select: { name: true, displayName: true } } },
    orderBy: [{ name: "asc" }],
    toHit: (p) => ({ id: p.id, title: p.name, subtitle: dot(p.projectNumber, p.client?.displayName || p.client?.name || p.clientName, label(p.status)), href: `/projects/${p.id}` }),
  },
  tasks: {
    label: "Tasks", delegate: "task",
    access: (u) => taskVisibilityWhere(u) as Where,
    match: fields(["title", "project.name", "project.projectNumber"]),
    exact: exactOn(["title"]),
    include: { project: { select: { name: true } } },
    orderBy: [{ updatedAt: "desc" }],
    toHit: (t) => ({ id: t.id, title: t.title, subtitle: dot(t.project?.name, label(t.status), t.dueDate && `due ${day(t.dueDate)}`), href: `/tasks/${t.id}` }),
  },
  clients: {
    label: "Clients", delegate: "client",
    access: (u) => clientVisibilityWhere(u) as Where,
    match: fields(["name", "displayName", "clientNumber", "generalEmail"]),
    exact: exactOn(["clientNumber", "name", "displayName"]),
    orderBy: [{ name: "asc" }],
    toHit: (c) => ({ id: c.id, title: c.displayName || c.name, subtitle: dot(c.clientNumber, label(c.status), c.generalEmail), href: `/clients/${c.id}` }),
  },
  contacts: {
    label: "Client contacts", delegate: "clientContact",
    access: (u) => {
      const clients = clientVisibilityWhere(u) as Where;
      return { organizationId: u.organizationId, client: clients };
    },
    match: fields(["firstName", "lastName", "email", "client.name"]),
    exact: exactOn(["email"]),
    include: { client: { select: { id: true, name: true, displayName: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    toHit: (c) => ({ id: c.id, title: `${c.firstName} ${c.lastName}`, subtitle: dot(c.client.displayName || c.client.name, c.title, c.email), href: `/clients/${c.client.id}` }),
  },
  equipment: {
    label: "Equipment", delegate: "equipment",
    access: (u) => ({ organizationId: u.organizationId }),
    match: fields(["assetNumber", "name", "serialNumber", "manufacturer", "model"]),
    exact: exactOn(["assetNumber", "serialNumber"]),
    orderBy: [{ assetNumber: "asc" }],
    toHit: (e) => ({ id: e.id, title: `${e.assetNumber} — ${e.name}`, subtitle: dot(label(e.status), e.serialNumber && `S/N ${e.serialNumber}`), href: `/rentals/equipment/${e.id}` }),
  },
  rentals: {
    label: "Rentals", delegate: "rental",
    access: (u) => ({ organizationId: u.organizationId }),
    match: fields(["rentalNumber", "customerReference", "client.name", "client.displayName", "project.name"]),
    exact: exactOn(["rentalNumber", "customerReference"]),
    include: { client: { select: { name: true, displayName: true } } },
    orderBy: [{ reservationStart: "desc" }],
    toHit: (r) => ({ id: r.id, title: r.rentalNumber, subtitle: dot(r.client?.displayName || r.client?.name, label(r.status), day(r.reservationStart)), href: `/rentals/${r.id}` }),
  },
  documents: {
    label: "Documents", delegate: "document",
    access: (u) => ({ AND: [documentVisibilityWhere(u) as Where, { status: "ACTIVE" }] }),
    // Metadata only: title, description, category and the current file name. File contents are never indexed.
    match: fields(["title", "description", "category.name", "currentVersion.originalFilename"]),
    exact: exactOn(["title", "currentVersion.originalFilename"]),
    include: { category: { select: { name: true } }, currentVersion: { select: { originalFilename: true } } },
    orderBy: [{ updatedAt: "desc" }],
    toHit: (d) => ({ id: d.id, title: d.title, subtitle: dot(d.category?.name, d.currentVersion?.originalFilename), href: `/documents/${d.id}` }),
  },
  invoices: {
    label: "Invoices", delegate: "invoice",
    access: (u) => invoiceVisibilityWhere(u) as Where,
    match: fields(["invoiceNumber", "clientReference", "purchaseOrderNumber", "client.name", "client.displayName"]),
    exact: exactOn(["invoiceNumber", "purchaseOrderNumber"]),
    include: { client: { select: { name: true, displayName: true } } },
    orderBy: [{ issueDate: "desc" }],
    toHit: (i) => ({ id: i.id, title: i.invoiceNumber ?? "Draft invoice", subtitle: dot(i.client.displayName || i.client.name, label(i.status), `${i.currency} ${i.total}`), href: `/invoices/${i.id}` }),
  },
  courses: {
    label: "Training courses", delegate: "trainingCourse",
    access: (u) => ({ organizationId: u.organizationId, ...(u.role === "EMPLOYEE" ? { active: true } : {}) }),
    match: fields(["name", "code", "provider", "description"]),
    exact: exactOn(["code", "name"]),
    orderBy: [{ name: "asc" }],
    toHit: (c) => ({ id: c.id, title: c.name, subtitle: dot(c.code, c.provider, !c.active && "inactive"), href: `/training?tab=courses` }),
  },
  maintenance: {
    label: "Maintenance records", delegate: "maintenanceRecord",
    access: (u) => ({ organizationId: u.organizationId }),
    match: fields(["description", "equipment.assetNumber", "equipment.name", "vendorName"]),
    exact: exactOn(["equipment.assetNumber"]),
    include: { equipment: { select: { assetNumber: true, name: true } } },
    orderBy: [{ openedAt: "desc" }],
    toHit: (m) => ({ id: m.id, title: `${m.equipment.assetNumber} — ${m.description}`.slice(0, 120), subtitle: dot(label(m.type), label(m.status), day(m.openedAt)), href: `/maintenance/${m.id}` }),
  },
};

export const SEARCH_ENTITIES = Object.keys(DEFS) as SearchEntity[];
export const searchLabel = (entity: SearchEntity) => DEFS[entity].label;
export const isSearchEntity = (value: string | undefined): value is SearchEntity => Boolean(value && value in DEFS);

export const MIN_QUERY_LENGTH = 2;
const MAX_TERMS = 5;
export const normalizeQuery = (raw: string | undefined | null) => (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 100);

const db = (prisma as any);

const EXACT_CAP = 200;

function build(def: Def, user: AuthenticatedUser, query: string) {
  const access = def.access(user);
  if (!access) return null;
  const terms = query.split(" ").slice(0, MAX_TERMS);
  // Every term must match somewhere; the module's own predicate is always one of the AND operands.
  const base: Where = { AND: [access, ...terms.map((term) => ({ OR: def.match(term) }))] };
  return { base, exact: { AND: [base, { OR: def.exact(query) }] } };
}

/** Exact matches first (bounded), then everything else the viewer can see, in the entity's natural order. */
async function exactIds(def: Def, where: NonNullable<ReturnType<typeof build>>): Promise<string[]> {
  const rows: Array<{ id: string }> = await db[def.delegate].findMany({ where: where.exact, select: { id: true }, orderBy: def.orderBy, take: EXACT_CAP });
  return rows.map((row) => row.id);
}
const withoutIds = (where: Where, ids: string[]): Where => (ids.length ? { AND: [where, { id: { notIn: ids } }] } : where);

/** One page of one entity, exact matches first. */
export async function searchEntity(user: AuthenticatedUser, entity: SearchEntity, rawQuery: string, page = 1, pageSize = 20): Promise<SearchGroup> {
  const def = DEFS[entity];
  const query = normalizeQuery(rawQuery);
  const where = query.length >= MIN_QUERY_LENGTH ? build(def, user, query) : null;
  if (!where) return { entity, label: def.label, hits: [], total: 0 };
  const delegate = db[def.delegate];
  const offset = (Math.max(1, page) - 1) * pageSize;
  const exact = await exactIds(def, where);
  const rest = withoutIds(where.base, exact);
  const restCount: number = await delegate.count({ where: rest });
  const exactRows: any[] = offset < exact.length ? await delegate.findMany({ where: { id: { in: exact.slice(offset, offset + pageSize) } }, include: def.include, orderBy: def.orderBy }) : [];
  const need = pageSize - exactRows.length;
  const restRows: any[] = need > 0 ? await delegate.findMany({ where: rest, include: def.include, orderBy: def.orderBy, skip: Math.max(0, offset - exact.length), take: need }) : [];
  const hits = [
    ...exactRows.map((row) => ({ entity, exact: true, ...def.toHit(row) })),
    ...restRows.map((row) => ({ entity, exact: false, ...def.toHit(row) })),
  ];
  return { entity, label: def.label, hits, total: exact.length + restCount };
}

/** Top hits per entity for the header dropdown: small limits, no counts. */
export async function searchSuggestions(user: AuthenticatedUser, rawQuery: string, perEntity = 3): Promise<SearchGroup[]> {
  const query = normalizeQuery(rawQuery);
  if (query.length < MIN_QUERY_LENGTH) return [];
  const groups = await Promise.all(SEARCH_ENTITIES.map(async (entity) => {
    const def = DEFS[entity];
    const where = build(def, user, query);
    if (!where) return { entity, label: def.label, hits: [] as SearchHit[], total: 0 };
    const delegate = db[def.delegate];
    const exactRows: any[] = await delegate.findMany({ where: where.exact, include: def.include, orderBy: def.orderBy, take: perEntity });
    const restRows: any[] = exactRows.length < perEntity ? await delegate.findMany({ where: withoutIds(where.base, exactRows.map((row) => row.id)), include: def.include, orderBy: def.orderBy, take: perEntity - exactRows.length }) : [];
    const hits = [...exactRows.map((r) => ({ entity, exact: true, ...def.toHit(r) })), ...restRows.map((r) => ({ entity, exact: false, ...def.toHit(r) }))];
    return { entity, label: def.label, hits, total: hits.length };
  }));
  return groups.filter((group) => group.hits.length);
}

/** Grouped overview for /search: top hits plus an accurate total for every entity. */
export async function searchOverview(user: AuthenticatedUser, rawQuery: string, perEntity = 5): Promise<SearchGroup[]> {
  const query = normalizeQuery(rawQuery);
  if (query.length < MIN_QUERY_LENGTH) return [];
  const groups = await Promise.all(SEARCH_ENTITIES.map((entity) => searchEntity(user, entity, query, 1, perEntity)));
  return groups.filter((group) => group.total > 0);
}
