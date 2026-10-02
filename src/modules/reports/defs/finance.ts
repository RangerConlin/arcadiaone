import type { Prisma } from "@/generated/prisma/client";
import { dateKeyUtc, diffDays, keyToDate } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { invoiceVisibilityWhere } from "@/modules/invoices/authorization";
import { ledgerWhere } from "@/modules/ledger/data";
import { ZERO, plainDecimal, toDecimal, type Money } from "@/modules/ledger/money";
import { dateCell, label, OPEN_INVOICE_STATUSES, pageRows, rangeOrDefault, window } from "../helpers";
import type { ReportContext, ReportDefinition } from "../types";

// Financial reports are limited to administrators and managers, and every query is additionally
// bounded by the same row-level scope the invoice and ledger modules use.
const financial = (user: { role: string }) => user.role === "ADMIN" || user.role === "MANAGER";
const OPERATIONAL = "Operational reporting from ArcadiaOne records. It is not a formal accounting statement.";
const AGING_CAP = 50_000;

function openInvoiceWhere(ctx: ReportContext): Prisma.InvoiceWhereInput {
  return {
    AND: [
      invoiceVisibilityWhere(ctx.user),
      { status: { in: [...OPEN_INVOICE_STATUSES] }, balanceDue: { gt: 0 } },
      ...(ctx.filters.client ? [{ clientId: ctx.filters.client }] : []),
      ...(ctx.filters.project ? [{ projectId: ctx.filters.project }] : []),
    ],
  };
}

export const AGING_BUCKETS = ["Current (not yet due)", "1–30 days overdue", "31–60 days overdue", "61–90 days overdue", "Over 90 days overdue"] as const;
export const agingBucket = (daysOverdue: number) => (daysOverdue <= 0 ? 0 : daysOverdue <= 30 ? 1 : daysOverdue <= 60 ? 2 : daysOverdue <= 90 ? 3 : 4);

const aging: ReportDefinition = {
  id: "invoice-aging", category: "financial", title: "Invoice aging",
  description: "Open invoice balances grouped by how far past due they are.",
  filters: ["client", "project"], access: financial,
  definition: `Balances of issued, sent and partially paid invoices, aged by due date as of today in your time zone. Current = not yet past due, or no due date. Buckets are per currency; amounts in different currencies are never added together. ${OPERATIONAL}`,
  async run(ctx) {
    const invoices = await prisma.invoice.findMany({ where: openInvoiceWhere(ctx), select: { dueDate: true, balanceDue: true, currency: true }, take: AGING_CAP });
    const totals = new Map<string, { count: number; balance: Money }>();
    for (const invoice of invoices) {
      const bucket = invoice.dueDate ? agingBucket(diffDays(dateKeyUtc(invoice.dueDate), ctx.today)) : 0;
      const key = `${invoice.currency}|${bucket}`;
      const entry = totals.get(key) ?? { count: 0, balance: ZERO };
      entry.count += 1;
      entry.balance = entry.balance.plus(toDecimal(invoice.balanceDue));
      totals.set(key, entry);
    }
    const currencies = [...new Set(invoices.map((i) => i.currency))].sort();
    const rows = currencies.flatMap((currency) => AGING_BUCKETS.map((name, index) => {
      const entry = totals.get(`${currency}|${index}`) ?? { count: 0, balance: ZERO };
      return [currency, name, entry.count, plainDecimal(entry.balance)] as [string, string, number, string];
    }));
    const notes = [`As of ${ctx.today}. ${OPERATIONAL}`];
    if (invoices.length >= AGING_CAP) notes.push(`Only the first ${AGING_CAP} open invoices were aged; narrow the filters.`);
    return { total: rows.length, notes, columns: [{ label: "Currency" }, { label: "Age bucket" }, { label: "Invoices", type: "number" }, { label: "Balance due", type: "money" }], rows };
  },
};

const outstanding: ReportDefinition = {
  id: "outstanding-invoices", category: "financial", title: "Outstanding invoices",
  description: "Open invoices with a balance, oldest due date first.",
  filters: ["client", "project", "dateRange"], access: financial,
  definition: `The date range filters on due date. Days overdue is blank until the day after the due date. ${OPERATIONAL}`,
  async run(ctx) {
    const f = ctx.filters;
    const where: Prisma.InvoiceWhereInput = { AND: [openInvoiceWhere(ctx), ...(f.from ? [{ dueDate: { gte: keyToDate(f.from) } }] : []), ...(f.to ? [{ dueDate: { lte: keyToDate(f.to) } }] : [])] };
    const [rows, total] = await prisma.$transaction([
      prisma.invoice.findMany({ where, include: { client: { select: { name: true } }, project: { select: { name: true } } }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "asc" }], ...window(ctx) }),
      prisma.invoice.count({ where }),
    ]);
    return {
      total, notes: [OPERATIONAL],
      columns: [{ label: "Invoice" }, { label: "Client" }, { label: "Project" }, { label: "Issued" }, { label: "Due" }, { label: "Days overdue", type: "number" }, { label: "Total", type: "money" }, { label: "Paid", type: "money" }, { label: "Balance", type: "money" }, { label: "Currency" }],
      rows: rows.map((i) => {
        const overdue = i.dueDate ? diffDays(dateKeyUtc(i.dueDate), ctx.today) : 0;
        return [i.invoiceNumber, i.client.name, i.project?.name ?? null, dateCell(i.issueDate), dateCell(i.dueDate), overdue > 0 ? overdue : null, plainDecimal(i.total), plainDecimal(i.amountPaid), plainDecimal(i.balanceDue), i.currency];
      }),
    };
  },
};

const payments: ReportDefinition = {
  id: "payments-received", category: "financial", title: "Payments received",
  description: "Payments recorded against invoices in a date range (default: last 30 days).",
  filters: ["dateRange", "client", "project"], access: financial,
  definition: `Payments that were later corrected (reversed) are excluded. Totals are per currency. ${OPERATIONAL}`,
  async run(ctx) {
    const range = rangeOrDefault(ctx, 30);
    const where: Prisma.PaymentWhereInput = {
      organizationId: ctx.user.organizationId, correctedAt: null, paymentDate: { gte: range.fromDate, lt: range.toExclusive },
      invoice: { AND: [invoiceVisibilityWhere(ctx.user), ...(ctx.filters.client ? [{ clientId: ctx.filters.client }] : []), ...(ctx.filters.project ? [{ projectId: ctx.filters.project }] : [])] },
    };
    const [rows, total, totals] = await prisma.$transaction([
      prisma.payment.findMany({ where, include: { invoice: { select: { invoiceNumber: true, currency: true, client: { select: { name: true } } } } }, orderBy: [{ paymentDate: "desc" }, { id: "asc" }], ...window(ctx) }),
      prisma.payment.count({ where }),
      prisma.payment.findMany({ where, select: { amount: true, invoice: { select: { currency: true } } }, take: 100_000 }),
    ]);
    const byCurrency = new Map<string, Money>();
    for (const p of totals) byCurrency.set(p.invoice.currency, (byCurrency.get(p.invoice.currency) ?? ZERO).plus(toDecimal(p.amount)));
    return {
      total, notes: [`Payments dated ${range.from} to ${range.to}. ${OPERATIONAL}`],
      summary: [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ label: `Total received (${currency})`, value: plainDecimal(amount), money: true })),
      columns: [{ label: "Payment date" }, { label: "Invoice" }, { label: "Client" }, { label: "Method", type: "status" }, { label: "Reference" }, { label: "Amount", type: "money" }, { label: "Currency" }],
      rows: rows.map((p) => [dateCell(p.paymentDate), p.invoice.invoiceNumber, p.invoice.client.name, label(p.method), p.reference, plainDecimal(p.amount), p.invoice.currency]),
    };
  },
};

const LEDGER_TYPES = [{ value: "INCOME", label: "Income" }, { value: "EXPENSE", label: "Expense" }, { value: "ADJUSTMENT", label: "Adjustment" }];

const ledgerActivity: ReportDefinition = {
  id: "ledger-activity", category: "financial", title: "Ledger activity",
  description: "Recorded ledger transactions in a date range (default: this year to date).",
  filters: ["dateRange", "status", "client", "project"], statusOptions: LEDGER_TYPES, access: financial,
  definition: `The status filter selects the transaction type. Voided transactions are excluded. Net recorded activity = income − expenses ± adjustments; it is not profit. ${OPERATIONAL}`,
  async run(ctx) {
    const range = rangeOrDefault(ctx, 365);
    const from = ctx.filters.from ?? `${ctx.today.slice(0, 4)}-01-01`;
    const where = ledgerWhere(ctx.user, { from, to: range.to, type: ctx.filters.status as never, clientId: ctx.filters.client, projectId: ctx.filters.project, includeVoided: false });
    const [rows, total, groups] = await prisma.$transaction([
      prisma.ledgerTransaction.findMany({ where, include: { category: true, client: { select: { name: true } }, project: { select: { name: true } } }, orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }, { id: "asc" }], ...window(ctx) }),
      prisma.ledgerTransaction.count({ where }),
      prisma.ledgerTransaction.groupBy({ by: ["currency", "type"], where, _sum: { amount: true }, orderBy: [{ currency: "asc" }, { type: "asc" }] }),
    ]);
    const summary = summarizeGroups(groups.map((g) => ({ currency: g.currency, type: g.type, amount: g._sum.amount })));
    return {
      total, summary, notes: [`Transactions dated ${from} to ${range.to}. ${OPERATIONAL}`],
      columns: [{ label: "Date" }, { label: "Number" }, { label: "Type", type: "status" }, { label: "Description" }, { label: "Category" }, { label: "Client" }, { label: "Project" }, { label: "Amount", type: "money" }, { label: "Currency" }, { label: "Reference" }],
      rows: rows.map((t) => [dateCell(t.transactionDate), t.transactionNumber, label(t.type), t.description, t.category?.name ?? null, t.client?.name ?? null, t.project?.name ?? null, plainDecimal(t.type === "EXPENSE" ? toDecimal(t.amount).negated() : t.amount), t.currency, t.reference]),
    };
  },
};

function summarizeGroups(groups: Array<{ currency: string; type: string; amount: Prisma.Decimal | null }>) {
  const byCurrency = new Map<string, { income: Money; expense: Money; adjustment: Money }>();
  for (const g of groups) {
    const e = byCurrency.get(g.currency) ?? { income: ZERO, expense: ZERO, adjustment: ZERO };
    const amount = toDecimal(g.amount);
    if (g.type === "INCOME") e.income = e.income.plus(amount); else if (g.type === "EXPENSE") e.expense = e.expense.plus(amount); else e.adjustment = e.adjustment.plus(amount);
    byCurrency.set(g.currency, e);
  }
  return [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([currency, e]) => [
    { label: `Income (${currency})`, value: plainDecimal(e.income), money: true },
    { label: `Expenses (${currency})`, value: plainDecimal(e.expense), money: true },
    { label: `Net recorded activity (${currency})`, value: plainDecimal(e.income.minus(e.expense).plus(e.adjustment)), money: true },
  ]);
}

const incomeExpense: ReportDefinition = {
  id: "income-expense-summary", category: "financial", title: "Income and expense summary",
  description: "Recorded income, expenses and adjustments by month (default: this year to date).",
  filters: ["dateRange", "client", "project"], access: financial,
  definition: `Months follow each transaction's date. Voided transactions are excluded. Net recorded activity is the sum of what was recorded, not profit: unrecorded costs and revenue are absent. ${OPERATIONAL}`,
  async run(ctx) {
    const from = ctx.filters.from ?? `${ctx.today.slice(0, 4)}-01-01`;
    const to = ctx.filters.to ?? ctx.today;
    const where = ledgerWhere(ctx.user, { from, to, clientId: ctx.filters.client, projectId: ctx.filters.project, includeVoided: false });
    const entries = await prisma.ledgerTransaction.findMany({ where, select: { transactionDate: true, type: true, amount: true, currency: true }, take: 100_000 });
    const buckets = new Map<string, { income: Money; expense: Money; adjustment: Money }>();
    for (const t of entries) {
      const key = `${dateKeyUtc(t.transactionDate).slice(0, 7)}|${t.currency}`;
      const e = buckets.get(key) ?? { income: ZERO, expense: ZERO, adjustment: ZERO };
      const amount = toDecimal(t.amount);
      if (t.type === "INCOME") e.income = e.income.plus(amount); else if (t.type === "EXPENSE") e.expense = e.expense.plus(amount); else e.adjustment = e.adjustment.plus(amount);
      buckets.set(key, e);
    }
    const rows = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, e]) => {
      const [month, currency] = key.split("|");
      return [month, currency, plainDecimal(e.income), plainDecimal(e.expense), plainDecimal(e.adjustment), plainDecimal(e.income.minus(e.expense).plus(e.adjustment))];
    });
    return {
      total: rows.length, notes: [`Transactions dated ${from} to ${to}. ${OPERATIONAL}`], summary: summarizeGroups(entries.map((t) => ({ currency: t.currency, type: t.type, amount: t.amount }))),
      columns: [{ label: "Month" }, { label: "Currency" }, { label: "Income", type: "money" }, { label: "Expenses", type: "money" }, { label: "Adjustments", type: "money" }, { label: "Net recorded activity", type: "money" }],
      rows: pageRows(ctx, rows),
    };
  },
};

export const financeReports = [aging, outstanding, payments, ledgerActivity, incomeExpense];
