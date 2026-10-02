import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuditAction, AuditEntityType } from "./actions";
import { sanitizeMetadata, sanitizeValue, type AuditChange } from "./sanitize";

/** Either the shared client or an interactive-transaction client. Pass `tx` to audit atomically. */
export type AuditDb = Pick<PrismaClient, "auditEvent"> | Prisma.TransactionClient;

export type AuditActor = { userId?: string | null; portalUserId?: string | null; label?: string | null };

export type AuditInput = {
  organizationId: string;
  actor: AuditActor;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  summary: string;
  /** Field-level changes, produced by `diffChanges` from allow-listed fields. */
  changes?: AuditChange[];
  /** Extra safe context (sanitized again here). Never pass secrets, tokens or document contents. */
  metadata?: Record<string, unknown>;
  outcome?: "SUCCESS" | "FAILURE";
};

/** Maps an authenticated internal user to an audit actor. Portal users must use `portalActor`. */
export const userActor = (user: { id: string; email: string }): AuditActor => ({ userId: user.id, label: user.email });
export const portalActor = (portalUser: { id: string; email: string }): AuditActor => ({ portalUserId: portalUser.id, label: `${portalUser.email} (portal)` });

async function requestMeta() {
  try {
    const { headers } = await import("next/headers");
    const list = await headers();
    const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip") || null;
    return { ipAddress: forwarded?.slice(0, 64) ?? null, userAgent: list.get("user-agent")?.slice(0, 300) ?? null };
  } catch {
    return { ipAddress: null, userAgent: null }; // outside a request (scripts, tests)
  }
}

async function record(db: AuditDb, input: AuditInput) {
  if (input.actor.userId && input.actor.portalUserId) throw new Error("An audit event has exactly one kind of actor.");
  const meta = sanitizeMetadata(input.metadata);
  const body: Record<string, unknown> = { ...meta };
  if (input.changes?.length) body.changes = input.changes.map((c) => ({ field: String(c.field).slice(0, 80), from: sanitizeValue(c.from), to: sanitizeValue(c.to) }));
  const request = await requestMeta();
  return db.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actor.userId ?? null,
      actorPortalUserId: input.actor.portalUserId ?? null,
      actorLabel: input.actor.label?.slice(0, 200) ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      outcome: input.outcome ?? "SUCCESS",
      summary: input.summary.slice(0, 500),
      metadata: Object.keys(body).length ? (body as Prisma.InputJsonObject) : undefined,
      ...request,
    },
  });
}

/**
 * The only way application code writes audit events.
 *
 *  - `audit.record(tx, …)` joins the caller's transaction: if the business change rolls back,
 *    so does the event, and a failed audit write rolls back the change.
 *  - `audit.recordStandalone(…)` is for events with no business transaction (login failures).
 *    It never throws, so an audit problem cannot lock people out.
 */
export const audit = {
  record,
  async recordStandalone(input: AuditInput) {
    try {
      await record(prisma, input);
    } catch (error) {
      console.error("[audit] failed to record event:", error instanceof Error ? error.message : error);
    }
  },
};
