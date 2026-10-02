import type { Prisma } from "@/generated/prisma/client";
import { dateKeyUtc, keyToDate } from "@/lib/datetime";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { audit, userActor, type AuditActor } from "@/modules/audit/service";
import { plainDecimal } from "./money";

type Tx = Prisma.TransactionClient;
type Actor = { id: string; email: string; organizationId: string };

/** Allocates the next per-organization transaction number atomically (inside the caller's transaction). */
async function nextTransactionNumber(tx: Tx, organizationId: string) {
  const rows = await tx.$queryRaw<Array<{ seq: number }>>`
    UPDATE "Organization" SET "nextLedgerSequence" = "nextLedgerSequence" + 1
    WHERE id = ${organizationId} RETURNING "nextLedgerSequence" - 1 AS seq`;
  if (!rows[0]) throw new Error("Organization not found.");
  return `LT-${String(rows[0].seq).padStart(6, "0")}`;
}

export type NewTransaction = {
  type: "INCOME" | "EXPENSE" | "ADJUSTMENT";
  transactionDate: Date;
  description: string;
  amount: Prisma.Decimal;
  currency?: string;
  categoryId?: string | null;
  clientId?: string | null;
  projectId?: string | null;
  rentalId?: string | null;
  invoiceId?: string | null;
  paymentId?: string | null;
  maintenanceRecordId?: string | null;
  equipmentId?: string | null;
  reference?: string | null;
  notes?: string | null;
};

const auditFields = (row: { type: string; amount: Prisma.Decimal; currency: string; transactionDate: Date; paymentId: string | null; invoiceId: string | null; projectId: string | null; clientId: string | null; rentalId: string | null }) => ({
  type: row.type, amount: plainDecimal(row.amount), currency: row.currency, date: dateKeyUtc(row.transactionDate),
  paymentId: row.paymentId, invoiceId: row.invoiceId, projectId: row.projectId, clientId: row.clientId, rentalId: row.rentalId,
});

/** Creates a transaction and its audit event in the caller's transaction. */
export async function createLedgerTransaction(tx: Tx, organizationId: string, actor: Actor | null, createdByUserId: string, data: NewTransaction, auditActor?: AuditActor) {
  const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { defaultCurrency: true } });
  const transactionNumber = await nextTransactionNumber(tx, organizationId);
  const row = await tx.ledgerTransaction.create({
    data: {
      organizationId, transactionNumber, createdByUserId,
      type: data.type, transactionDate: data.transactionDate, description: data.description, amount: data.amount,
      currency: (data.currency ?? organization.defaultCurrency).toUpperCase(),
      categoryId: data.categoryId ?? null, clientId: data.clientId ?? null, projectId: data.projectId ?? null,
      rentalId: data.rentalId ?? null, invoiceId: data.invoiceId ?? null, paymentId: data.paymentId ?? null, maintenanceRecordId: data.maintenanceRecordId ?? null,
      equipmentId: data.equipmentId ?? null, reference: data.reference ?? null, notes: data.notes ?? null,
    },
  });
  await audit.record(tx, {
    organizationId, actor: auditActor ?? (actor ? userActor(actor) : {}), action: AUDIT_ACTIONS.ledgerCreated, entityType: "LedgerTransaction", entityId: row.id,
    summary: `${row.type.toLowerCase()} ${row.transactionNumber}: ${row.currency} ${plainDecimal(row.amount)}${data.paymentId ? " (posted from payment)" : ""}`,
    metadata: auditFields(row),
  });
  return row;
}

/**
 * Posts a recorded Payment to the ledger as INCOME.
 *
 * Deterministic and idempotent: `LedgerTransaction.paymentId` is unique, the lookup short-circuits
 * when an entry exists, and the insert uses ON CONFLICT DO NOTHING, so processing the same payment
 * any number of times (retry, double submit, backfill) yields exactly one entry.
 */
export async function postPaymentToLedger(tx: Tx, organizationId: string, paymentId: string, actor: Actor | null) {
  const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { autoPostPaymentsToLedger: true, defaultCurrency: true } });
  if (!organization.autoPostPaymentsToLedger) return null;
  const payment = await tx.payment.findFirst({
    where: { id: paymentId, organizationId, correctedAt: null },
    include: { invoice: { select: { id: true, invoiceNumber: true, currency: true, clientId: true, projectId: true, rentalId: true, client: { select: { name: true } } } }, ledgerTransaction: true },
  });
  if (!payment) return null;
  if (payment.ledgerTransaction) return payment.ledgerTransaction; // already posted: nothing to do
  const transactionNumber = await nextTransactionNumber(tx, organizationId);
  const inserted = await tx.ledgerTransaction.createMany({
    skipDuplicates: true,
    data: [{
      organizationId, transactionNumber, createdByUserId: payment.recordedByUserId, type: "INCOME",
      transactionDate: keyToDate(dateKeyUtc(payment.paymentDate)), description: `Payment received — ${payment.invoice.invoiceNumber ?? "invoice"} (${payment.invoice.client.name})`,
      amount: payment.amount, currency: payment.invoice.currency, clientId: payment.invoice.clientId, projectId: payment.invoice.projectId,
      rentalId: payment.invoice.rentalId, invoiceId: payment.invoice.id, paymentId: payment.id, reference: payment.reference ?? payment.invoice.invoiceNumber,
    }],
  });
  if (!inserted.count) return null;
  const row = await tx.ledgerTransaction.findUniqueOrThrow({ where: { paymentId: payment.id } });
  await audit.record(tx, {
    organizationId, actor: actor ? userActor(actor) : {}, action: AUDIT_ACTIONS.ledgerCreated, entityType: "LedgerTransaction", entityId: row.id,
    summary: `income ${row.transactionNumber}: ${row.currency} ${plainDecimal(row.amount)} (posted from payment)`, metadata: auditFields(row),
  });
  return row;
}

/** Voids a transaction. The original row, who voided it, when, and why are all preserved. */
export async function voidLedgerTransaction(tx: Tx, organizationId: string, actor: Actor, id: string, reason: string, options: { allowPaymentLinked?: boolean } = {}) {
  const existing = await tx.ledgerTransaction.findFirst({ where: { id, organizationId } });
  if (!existing) throw new Error("Transaction not found.");
  if (existing.voidedAt) throw new Error("This transaction is already void.");
  if (existing.paymentId && !options.allowPaymentLinked) {
    throw new Error("This entry was posted from an invoice payment. Correct the payment on the invoice instead; the ledger entry is voided with it.");
  }
  const result = await tx.ledgerTransaction.updateMany({
    where: { id, organizationId, voidedAt: null }, data: { voidedAt: new Date(), voidedByUserId: actor.id, voidReason: reason },
  });
  if (!result.count) throw new Error("This transaction is already void.");
  await audit.record(tx, {
    organizationId, actor: userActor(actor), action: AUDIT_ACTIONS.ledgerVoided, entityType: "LedgerTransaction", entityId: id,
    summary: `Voided ${existing.transactionNumber ?? id}: ${reason}`.slice(0, 500), metadata: { ...auditFields(existing), reason },
  });
}

/** Called when a payment is corrected, so the ledger never keeps income for a reversed payment. */
export async function voidLedgerForPayment(tx: Tx, organizationId: string, actor: Actor, paymentId: string, reason: string) {
  const entry = await tx.ledgerTransaction.findFirst({ where: { organizationId, paymentId, voidedAt: null }, select: { id: true } });
  if (entry) await voidLedgerTransaction(tx, organizationId, actor, entry.id, `Payment corrected: ${reason}`, { allowPaymentLinked: true });
}
