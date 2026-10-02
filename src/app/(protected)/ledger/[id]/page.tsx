import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Field, inputClass, Notice, SecondaryLink, StatusBadge } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { dateKeyUtc, formatDateTimeInZone, formatDayKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { voidLedgerEntry } from "@/modules/ledger/actions";
import { canAccessLedger, canVoidLedgerTransaction, ledgerVisibilityWhere } from "@/modules/ledger/authorization";
import { formatMoney } from "@/modules/ledger/money";

export const dynamic = "force-dynamic";

export default async function LedgerDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ success?: string; error?: string }> }) {
  const user = await requireAuthenticatedUser();
  if (!canAccessLedger(user)) redirect("/forbidden");
  const [{ id }, query, zone] = await Promise.all([params, searchParams, getViewerTimeZone(user)]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const row = await prisma.ledgerTransaction.findFirst({
    where: { id, ...ledgerVisibilityWhere(user) },
    include: {
      category: true, client: true, project: true, rental: true, invoice: true, equipment: true, payment: { select: { id: true } },
      createdBy: { select: { email: true } }, voidedBy: { select: { email: true } },
    },
  });
  if (!row) notFound();
  const link = (href: string, text: string) => <Link className="text-[color:var(--accent)] underline" href={href}>{text}</Link>;
  return (
    <>
      <PageHeader
        actions={<>
          {canAccessLedger(user) && user.role === "ADMIN" ? <SecondaryLink href={`/administration/audit?entityType=LedgerTransaction&entityId=${row.id}`}>Audit history</SecondaryLink> : null}
          <SecondaryLink href="/ledger">Back to ledger</SecondaryLink>
        </>}
        breadcrumbs={[{ label: "Ledger", href: "/ledger" }, { label: row.transactionNumber ?? "Transaction" }]}
        title={row.description}
      />
      <Notice message={query.success} tone="success" />
      <Notice message={query.error} tone="error" />
      <section className="mb-6 max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <div className="mb-3 flex items-center gap-2"><StatusBadge status={row.type} />{row.voidedAt ? <span className="badge" data-tone="bad">void</span> : null}</div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold">Amount</dt><dd className="text-lg font-bold tabular-nums">{row.type === "EXPENSE" ? "−" : ""}{formatMoney(row.amount, row.currency)}</dd></div>
          <div><dt className="font-semibold">Date</dt><dd>{formatDayKey(dateKeyUtc(row.transactionDate))}</dd></div>
          <div><dt className="font-semibold">Number</dt><dd>{row.transactionNumber ?? "—"}</dd></div>
          <div><dt className="font-semibold">Category</dt><dd>{row.category?.name ?? "—"}</dd></div>
          <div><dt className="font-semibold">Client</dt><dd>{row.client ? link(`/clients/${row.client.id}`, row.client.name) : "—"}</dd></div>
          <div><dt className="font-semibold">Project</dt><dd>{row.project ? link(`/projects/${row.project.id}`, row.project.name) : "—"}</dd></div>
          <div><dt className="font-semibold">Rental</dt><dd>{row.rental ? link(`/rentals/${row.rental.id}`, row.rental.rentalNumber) : "—"}</dd></div>
          <div><dt className="font-semibold">Invoice</dt><dd>{row.invoice ? link(`/invoices/${row.invoice.id}`, row.invoice.invoiceNumber ?? "Invoice") : "—"}</dd></div>
          <div><dt className="font-semibold">Equipment</dt><dd>{row.equipment ? link(`/rentals/equipment/${row.equipment.id}`, `${row.equipment.assetNumber} — ${row.equipment.name}`) : "—"}</dd></div>
          <div><dt className="font-semibold">Reference</dt><dd>{row.reference ?? "—"}</dd></div>
          <div><dt className="font-semibold">Recorded by</dt><dd>{row.createdBy.email} · {formatDateTimeInZone(row.createdAt, zone)}</dd></div>
          {row.payment ? <div><dt className="font-semibold">Source</dt><dd>Posted automatically from an invoice payment</dd></div> : null}
        </dl>
        {row.notes ? <p className="mt-4 whitespace-pre-wrap text-sm">{row.notes}</p> : null}
        {row.voidedAt ? (
          <div className="mt-4 rounded-sm border border-[color:var(--border)] p-3 text-sm">
            <p className="font-semibold">Voided {formatDateTimeInZone(row.voidedAt, zone)} by {row.voidedBy?.email ?? "unknown"}</p>
            <p>Reason: {row.voidReason}</p>
            <p className="mt-1 text-xs text-[color:var(--muted)]">The original record above is unchanged and excluded from totals.</p>
          </div>
        ) : null}
      </section>
      {!row.voidedAt && canVoidLedgerTransaction(user) ? (
        <form action={voidLedgerEntry} className="grid max-w-4xl gap-3 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
          <input name="id" type="hidden" value={row.id} />
          <h2 className="text-base font-semibold">Void this transaction</h2>
          {row.payment ? <p className="text-sm text-[color:var(--muted)]">This entry came from an invoice payment; correct the payment on the invoice to void it.</p> : null}
          <Field label="Reason (required)"><input className={inputClass} maxLength={500} minLength={3} name="reason" required /></Field>
          <div><button className="cal-btn" disabled={Boolean(row.payment)} type="submit">Void transaction</button></div>
        </form>
      ) : null}
    </>
  );
}
