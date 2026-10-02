import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedUser } from "@/lib/auth/session";
import { addDays, isDayKey, startOfDayUtc } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "./actions";

export const AUDIT_PAGE_SIZE = 50;

export type AuditFilters = { from?: string; to?: string; actor?: string; action?: string; entityType?: string; entityId?: string; q?: string; outcome?: "SUCCESS" | "FAILURE"; page: number };
type Params = Record<string, string | string[] | undefined>;
const one = (params: Params, key: string) => { const v = params[key]; return (Array.isArray(v) ? v[0] : v)?.trim() || undefined; };
const ACTION_VALUES: string[] = Object.values(AUDIT_ACTIONS);

export function parseAuditFilters(params: Params): AuditFilters {
  const action = one(params, "action");
  const entityType = one(params, "entityType");
  const entityId = one(params, "entityId");
  return {
    from: isDayKey(one(params, "from")) ? one(params, "from") : undefined,
    to: isDayKey(one(params, "to")) ? one(params, "to") : undefined,
    actor: one(params, "actor")?.slice(0, 100),
    action: action && (ACTION_VALUES.includes(action) || ACTION_VALUES.some((value) => value.startsWith(`${action}.`))) ? action : undefined,
    entityType: (AUDIT_ENTITY_TYPES as readonly string[]).includes(entityType ?? "") ? entityType : undefined,
    entityId: entityId && /^[0-9a-f-]{36}$/i.test(entityId) ? entityId : undefined,
    q: one(params, "q")?.slice(0, 100),
    outcome: one(params, "outcome") === "FAILURE" ? "FAILURE" : one(params, "outcome") === "SUCCESS" ? "SUCCESS" : undefined,
    page: Math.max(1, Number(one(params, "page")) || 1),
  };
}

/** Organization comes from the authenticated user, never from the request. */
export function auditWhere(user: Pick<AuthenticatedUser, "organizationId">, f: Omit<AuditFilters, "page">, zone: string): Prisma.AuditEventWhereInput {
  const and: Prisma.AuditEventWhereInput[] = [{ organizationId: user.organizationId }];
  if (f.from) and.push({ occurredAt: { gte: startOfDayUtc(f.from, zone) } });
  if (f.to) and.push({ occurredAt: { lt: startOfDayUtc(addDays(f.to, 1), zone) } });
  if (f.actor) and.push({ OR: [{ actorLabel: { contains: f.actor, mode: "insensitive" } }, ...(/^[0-9a-f-]{36}$/i.test(f.actor) ? [{ actorUserId: f.actor }, { actorPortalUserId: f.actor }] : [])] });
  if (f.action) and.push(ACTION_VALUES.includes(f.action) ? { action: f.action } : { action: { startsWith: `${f.action}.` } });
  if (f.entityType) and.push({ entityType: f.entityType });
  if (f.entityId) and.push({ entityId: f.entityId });
  if (f.outcome) and.push({ outcome: f.outcome });
  if (f.q) and.push({ summary: { contains: f.q, mode: "insensitive" } });
  return { AND: and };
}

export async function listAuditEvents(user: AuthenticatedUser, filters: AuditFilters, zone: string) {
  const where = auditWhere(user, filters, zone);
  const [rows, total] = await prisma.$transaction([
    prisma.auditEvent.findMany({ where, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: (filters.page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE }),
    prisma.auditEvent.count({ where }),
  ]);
  return { rows, total, page: filters.page, pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)) };
}
