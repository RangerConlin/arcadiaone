import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedUser } from "@/lib/auth/session";
import { isDayKey, keyToDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { ledgerVisibilityWhere } from "./authorization";
import { ZERO, toDecimal } from "./money";

export const LEDGER_PAGE_SIZE = 50;
export const LEDGER_TYPES = ["INCOME", "EXPENSE", "ADJUSTMENT"] as const;

export type LedgerFilters = {
  from?: string; to?: string; type?: (typeof LEDGER_TYPES)[number]; categoryId?: string; clientId?: string;
  projectId?: string; rentalId?: string; invoiceId?: string; q?: string; includeVoided: boolean; page: number;
};

type Params = Record<string, string | string[] | undefined>;
const one = (params: Params, key: string) => { const v = params[key]; return (Array.isArray(v) ? v[0] : v)?.trim() || undefined; };
const id = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

/** Whitelists and validates query parameters; nothing else reaches a query. */
export function parseLedgerFilters(params: Params): LedgerFilters {
  const type = one(params, "type");
  return {
    from: isDayKey(one(params, "from")) ? one(params, "from") : undefined,
    to: isDayKey(one(params, "to")) ? one(params, "to") : undefined,
    type: LEDGER_TYPES.find((t) => t === type),
    categoryId: id(one(params, "category")), clientId: id(one(params, "client")), projectId: id(one(params, "project")),
    rentalId: id(one(params, "rental")), invoiceId: id(one(params, "invoice")),
    q: one(params, "q")?.slice(0, 100),
    includeVoided: one(params, "voided") === "1",
    page: Math.max(1, Number(one(params, "page")) || 1),
  };
}

export function ledgerWhere(user: AuthenticatedUser, f: Omit<LedgerFilters, "page" | "includeVoided"> & { includeVoided?: boolean }): Prisma.LedgerTransactionWhereInput {
  const and: Prisma.LedgerTransactionWhereInput[] = [ledgerVisibilityWhere(user)];
  if (!f.includeVoided) and.push({ voidedAt: null });
  if (f.from) and.push({ transactionDate: { gte: keyToDate(f.from) } });
  if (f.to) and.push({ transactionDate: { lte: keyToDate(f.to) } });
  if (f.type) and.push({ type: f.type });
  if (f.categoryId) and.push({ categoryId: f.categoryId });
  if (f.clientId) and.push({ clientId: f.clientId });
  if (f.projectId) and.push({ projectId: f.projectId });
  if (f.rentalId) and.push({ rentalId: f.rentalId });
  if (f.invoiceId) and.push({ invoiceId: f.invoiceId });
  if (f.q) {
    and.push({ OR: [
      { description: { contains: f.q, mode: "insensitive" } }, { reference: { contains: f.q, mode: "insensitive" } },
      { transactionNumber: { contains: f.q, mode: "insensitive" } }, { notes: { contains: f.q, mode: "insensitive" } },
    ] });
  }
  return { AND: and };
}

export const ledgerInclude = {
  category: { select: { name: true } }, client: { select: { id: true, name: true } }, project: { select: { id: true, name: true } },
  rental: { select: { id: true, rentalNumber: true } }, invoice: { select: { id: true, invoiceNumber: true } },
} satisfies Prisma.LedgerTransactionInclude;

export async function listLedger(user: AuthenticatedUser, filters: LedgerFilters) {
  const where = ledgerWhere(user, filters);
  const [rows, total] = await prisma.$transaction([
    prisma.ledgerTransaction.findMany({ where, include: ledgerInclude, orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }, { id: "desc" }], skip: (filters.page - 1) * LEDGER_PAGE_SIZE, take: LEDGER_PAGE_SIZE }),
    prisma.ledgerTransaction.count({ where }),
  ]);
  return { rows, total, page: filters.page, pages: Math.max(1, Math.ceil(total / LEDGER_PAGE_SIZE)) };
}

export type LedgerSummaryRow = { currency: string; income: string; expense: string; adjustments: string; net: string; count: number };

/**
 * Totals computed by the database (exact numeric SUM) and combined with Decimal arithmetic.
 * Voided entries never count. Net Recorded Activity = income − expenses + signed adjustments,
 * per currency; it is not profit.
 */
export async function ledgerSummary(user: AuthenticatedUser, filters: Omit<LedgerFilters, "page" | "includeVoided">): Promise<LedgerSummaryRow[]> {
  const groups = await prisma.ledgerTransaction.groupBy({
    by: ["currency", "type"], where: ledgerWhere(user, { ...filters, includeVoided: false }), _sum: { amount: true }, _count: { _all: true },
  });
  const byCurrency = new Map<string, { income: ReturnType<typeof toDecimal>; expense: ReturnType<typeof toDecimal>; adjustments: ReturnType<typeof toDecimal>; count: number }>();
  for (const g of groups) {
    const entry = byCurrency.get(g.currency) ?? { income: ZERO, expense: ZERO, adjustments: ZERO, count: 0 };
    const amount = toDecimal(g._sum.amount);
    if (g.type === "INCOME") entry.income = entry.income.plus(amount);
    else if (g.type === "EXPENSE") entry.expense = entry.expense.plus(amount);
    else entry.adjustments = entry.adjustments.plus(amount);
    entry.count += g._count._all;
    byCurrency.set(g.currency, entry);
  }
  return [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, e]) => ({
    currency, income: e.income.toFixed(2), expense: e.expense.toFixed(2), adjustments: e.adjustments.toFixed(2),
    net: e.income.minus(e.expense).plus(e.adjustments).toFixed(2), count: e.count,
  }));
}

export async function ledgerOptions(user: AuthenticatedUser) {
  const [categories] = await Promise.all([
    prisma.ledgerCategory.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
  ]);
  return { categories };
}
