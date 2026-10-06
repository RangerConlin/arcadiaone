import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { audit, userActor } from "@/modules/audit/service";
import { diffChanges, type AuditChange } from "@/modules/audit/sanitize";
import { NOTIFICATION_CATEGORIES } from "@/modules/notifications/constants";
import { NUMBER_ENTITIES, type NumberEntity } from "./numbering";
import {
  defaultsSchema, featuresSchema, firstIssue, identitySchema, notificationsSchema,
  prefixField, sequenceField, thresholdsSchema,
} from "./validation";

type Admin = { id: string; email: string; organizationId: string };
export type SectionResult = { ok: true; changed: number } | { ok: false; error: string };

const entries = (form: FormData) => Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;

/** Selected, non-secret settings every signed-in user may read indirectly (shell, forms, PDFs). */
export async function getShellSettings(organizationId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, displayName: true, logoStorageKey: true, featureRentals: true, featureLedger: true, featureTraining: true, featureMaintenance: true, featureClientPortal: true },
  });
  return {
    name: org?.displayName || org?.name || "",
    hasLogo: Boolean(org?.logoStorageKey),
    features: {
      rentals: org?.featureRentals ?? true, ledger: org?.featureLedger ?? true, training: org?.featureTraining ?? true,
      maintenance: org?.featureMaintenance ?? true, clientPortal: org?.featureClientPortal ?? true,
    },
  };
}

export async function getNumbering(organizationId: string) {
  const [org, rows] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { invoicePrefix: true, nextInvoiceSequence: true, ledgerPrefix: true, nextLedgerSequence: true } }),
    prisma.numberSequence.findMany({ where: { organizationId } }),
  ]);
  const byEntity = new Map(rows.map((row) => [row.entity, row]));
  const sequences = (Object.keys(NUMBER_ENTITIES) as NumberEntity[]).map((entity) => {
    const config = NUMBER_ENTITIES[entity];
    const row = byEntity.get(entity);
    return { entity, label: config.label, optional: config.optional, prefix: row?.prefix ?? config.prefix, nextValue: row?.nextValue ?? 1, autoAssign: row?.autoAssign ?? config.autoAssign };
  });
  return { sequences, ...org };
}

async function saveSimple(admin: Admin, data: Record<string, unknown>, fields: string[], action: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS], summary: string, extraChanges: (before: Record<string, unknown>) => AuditChange[] = () => []): Promise<SectionResult> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({ where: { id: admin.organizationId } });
    await tx.organization.update({ where: { id: admin.organizationId }, data: data as never });
    const changes = [...diffChanges(before as unknown as Record<string, unknown>, data, fields), ...extraChanges(before as unknown as Record<string, unknown>)];
    if (changes.length) await audit.record(tx, { organizationId: admin.organizationId, actor: userActor(admin), action, entityType: "Organization", entityId: admin.organizationId, summary, changes });
    return { ok: true as const, changed: changes.length };
  });
}

export async function saveSettingsSection(admin: Admin, section: string, form: FormData): Promise<SectionResult> {
  const input = entries(form);
  switch (section) {
    case "identity": {
      const parsed = identitySchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
      return saveSimple(admin, parsed.data, Object.keys(parsed.data), AUDIT_ACTIONS.settingsIdentityChanged, "Organization identity changed");
    }
    case "thresholds": {
      const parsed = thresholdsSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
      return saveSimple(admin, parsed.data, Object.keys(parsed.data), AUDIT_ACTIONS.settingsThresholdsChanged, "Due-soon thresholds changed");
    }
    case "defaults": {
      const parsed = defaultsSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
      return saveSimple(admin, parsed.data, Object.keys(parsed.data), AUDIT_ACTIONS.settingsDefaultsChanged, "Qualification, rental or invoice defaults changed");
    }
    case "notifications": {
      const parsed = notificationsSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
      const enabled = new Set(form.getAll("enabledCategories").map(String));
      const off = NOTIFICATION_CATEGORIES.filter((category) => !enabled.has(category));
      const data = { ...parsed.data, notificationDefaultOffCategories: off };
      return saveSimple(admin, data, ["notificationArchiveAfterDays", "notificationDefaultOffCategories"], AUDIT_ACTIONS.settingsNotificationsChanged, "Notification defaults changed");
    }
    case "features": {
      const parsed = featuresSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
      return saveSimple(admin, parsed.data, Object.keys(parsed.data), AUDIT_ACTIONS.settingsFeaturesChanged, "Feature availability changed");
    }
    case "numbering": return saveNumbering(admin, input);
    default: return { ok: false, error: "Unknown settings section." };
  }
}

async function saveNumbering(admin: Admin, input: Record<string, string>): Promise<SectionResult> {
  const next = (name: string) => sequenceField.safeParse(input[name]);
  const prefix = (name: string) => prefixField.safeParse(input[name] ?? "");
  const rows: Array<{ entity: NumberEntity; prefix: string; nextValue: number; autoAssign: boolean }> = [];
  for (const entity of Object.keys(NUMBER_ENTITIES) as NumberEntity[]) {
    const p = prefix(`${entity}.prefix`), n = next(`${entity}.nextValue`);
    if (!p.success) return { ok: false, error: `${NUMBER_ENTITIES[entity].label}: ${firstIssue(p.error)}` };
    if (!n.success) return { ok: false, error: `${NUMBER_ENTITIES[entity].label}: ${firstIssue(n.error)}` };
    rows.push({ entity, prefix: p.data, nextValue: n.data, autoAssign: NUMBER_ENTITIES[entity].optional ? input[`${entity}.autoAssign`] === "on" : true });
  }
  const invoicePrefix = prefix("invoicePrefix"), invoiceNext = next("nextInvoiceSequence"), ledgerPrefix = prefix("ledgerPrefix"), ledgerNext = next("nextLedgerSequence");
  for (const [label, r] of [["Invoices", invoicePrefix], ["Invoices", invoiceNext], ["Ledger", ledgerPrefix], ["Ledger", ledgerNext]] as const) if (!r.success) return { ok: false, error: `${label}: ${firstIssue(r.error)}` };
  if (!invoicePrefix.success || !invoiceNext.success || !ledgerPrefix.success || !ledgerNext.success) return { ok: false, error: "Invalid numbering settings." };
  if (!invoicePrefix.data || !ledgerPrefix.data) return { ok: false, error: "Invoice and ledger numbers need a prefix." };

  return prisma.$transaction(async (tx) => {
    // Lock the org row so a concurrent allocation cannot slip between the check and the write.
    const [locked] = await tx.$queryRaw<Array<{ nextInvoiceSequence: number; nextLedgerSequence: number }>>`SELECT "nextInvoiceSequence", "nextLedgerSequence" FROM "Organization" WHERE id = ${admin.organizationId} FOR UPDATE`;
    if (!locked) return { ok: false as const, error: "Organization not found." };
    // Issued invoice and ledger numbers are unique, so these counters may only move forward.
    if (invoiceNext.data < locked.nextInvoiceSequence) return { ok: false as const, error: `Invoices: the next number cannot be lowered below ${locked.nextInvoiceSequence} (numbers already issued).` };
    if (ledgerNext.data < locked.nextLedgerSequence) return { ok: false as const, error: `Ledger: the next number cannot be lowered below ${locked.nextLedgerSequence} (numbers already issued).` };
    const before = await tx.organization.findUniqueOrThrow({ where: { id: admin.organizationId }, select: { invoicePrefix: true, nextInvoiceSequence: true, ledgerPrefix: true, nextLedgerSequence: true } });
    const after = { invoicePrefix: invoicePrefix.data, nextInvoiceSequence: invoiceNext.data, ledgerPrefix: ledgerPrefix.data, nextLedgerSequence: ledgerNext.data };
    await tx.organization.update({ where: { id: admin.organizationId }, data: after });
    const changes = diffChanges(before, after, Object.keys(after));
    const existing = new Map((await tx.numberSequence.findMany({ where: { organizationId: admin.organizationId } })).map((row) => [row.entity, row]));
    for (const row of rows) {
      const old = existing.get(row.entity) ?? { prefix: NUMBER_ENTITIES[row.entity].prefix, nextValue: 1, autoAssign: NUMBER_ENTITIES[row.entity].autoAssign };
      await tx.numberSequence.upsert({
        where: { organizationId_entity: { organizationId: admin.organizationId, entity: row.entity } },
        create: { organizationId: admin.organizationId, entity: row.entity, prefix: row.prefix, nextValue: row.nextValue, autoAssign: row.autoAssign },
        update: { prefix: row.prefix, nextValue: row.nextValue, autoAssign: row.autoAssign },
      });
      changes.push(...diffChanges({ ...old }, row, ["prefix", "nextValue", "autoAssign"]).map((change) => ({ ...change, field: `${row.entity}.${change.field}` })));
    }
    if (changes.length) await audit.record(tx, { organizationId: admin.organizationId, actor: userActor(admin), action: AUDIT_ACTIONS.settingsNumberingChanged, entityType: "Organization", entityId: admin.organizationId, summary: "Numbering settings changed", changes });
    return { ok: true as const, changed: changes.length };
  });
}

const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_LOGO_BYTES = 1024 * 1024;

/** Stores the logo in the shared object storage (the same backend as Documents). PNG/JPEG/WebP only, ≤ 1 MB. */
export async function saveLogo(admin: Admin, file: File | null): Promise<SectionResult> {
  const { documentStorage } = await import("@/modules/documents/storage");
  const { validateUpload } = await import("@/modules/documents/validation");
  if (!file || !file.size) return { ok: false, error: "Choose a PNG, JPEG or WebP image." };
  if (!LOGO_TYPES.has(file.type)) return { ok: false, error: "The logo must be a PNG, JPEG or WebP image." };
  if (file.size > MAX_LOGO_BYTES) return { ok: false, error: "The logo must be 1 MB or smaller." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  let mimeType: string;
  try { mimeType = validateUpload({ bytes, filename: file.name, mimeType: file.type }).mimeType; } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Invalid logo file." }; }
  const stored = await documentStorage.store(bytes);
  try {
    const previous = await prisma.$transaction(async (tx) => {
      const before = await tx.organization.findUniqueOrThrow({ where: { id: admin.organizationId }, select: { logoStorageKey: true } });
      await tx.organization.update({ where: { id: admin.organizationId }, data: { logoStorageKey: stored.key, logoMimeType: mimeType } });
      await audit.record(tx, { organizationId: admin.organizationId, actor: userActor(admin), action: AUDIT_ACTIONS.settingsBrandingChanged, entityType: "Organization", entityId: admin.organizationId, summary: before.logoStorageKey ? "Organization logo replaced" : "Organization logo uploaded", metadata: { sizeBytes: stored.sizeBytes, mimeType } });
      return before.logoStorageKey;
    });
    if (previous) await documentStorage.delete(previous);
    return { ok: true, changed: 1 };
  } catch (error) { await documentStorage.delete(stored.key); throw error; }
}

export async function removeLogo(admin: Admin): Promise<SectionResult> {
  const { documentStorage } = await import("@/modules/documents/storage");
  const previous = await prisma.$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({ where: { id: admin.organizationId }, select: { logoStorageKey: true } });
    if (!before.logoStorageKey) return null;
    await tx.organization.update({ where: { id: admin.organizationId }, data: { logoStorageKey: null, logoMimeType: null } });
    await audit.record(tx, { organizationId: admin.organizationId, actor: userActor(admin), action: AUDIT_ACTIONS.settingsBrandingChanged, entityType: "Organization", entityId: admin.organizationId, summary: "Organization logo removed" });
    return before.logoStorageKey;
  });
  if (previous) await documentStorage.delete(previous);
  return { ok: true, changed: previous ? 1 : 0 };
}
