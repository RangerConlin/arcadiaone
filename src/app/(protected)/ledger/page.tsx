import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DataTable, Pager, rowClass } from "@/components/data-table";
import { ButtonLink, inputClass, SecondaryLink, StatusBadge } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { dateKeyUtc, formatDayKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { clientVisibilityWhere } from "@/modules/clients/authorization";
import { canAccessLedger, canAdministerLedgerSettings, canManageLedger } from "@/modules/ledger/authorization";
import { LEDGER_PAGE_SIZE, LEDGER_TYPES, ledgerOptions, ledgerSummary, listLedger, parseLedgerFilters } from "@/modules/ledger/data";
import { formatDecimal } from "@/modules/ledger/money";
import { projectVisibilityWhere } from "@/modules/projects/authorization";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const label = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

export default async function LedgerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAuthenticatedUser();
  if (!canAccessLedger(user)) redirect("/forbidden");
  const params = await searchParams;
  const filters = parseLedgerFilters(params);
  const [list, summary, options, clients, projects] = await Promise.all([
    listLedger(user, filters),
    ledgerSummary(user, filters),
    ledgerOptions(user),
    prisma.client.findMany({ where: clientVisibilityWhere(user), select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
    prisma.project.findMany({ where: projectVisibilityWhere(user), select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
  ]);
  const pagerParams: Record<string, string | undefined> = {
    from: filters.from, to: filters.to, type: filters.type, category: filters.categoryId, client: filters.clientId, project: filters.projectId,
    rental: filters.rentalId, invoice: filters.invoiceId, q: filters.q, voided: filters.includeVoided ? "1" : undefined,
  };
  return (
    <>
      <PageHeader
        actions={<>
          {canAdministerLedgerSettings(user) ? <SecondaryLink href="/ledger/categories">Categories</SecondaryLink> : null}
          <SecondaryLink href={`/reports/ledger-activity${list.total ? `?${new URLSearchParams(Object.entries(pagerParams).filter(([, v]) => v) as [string, string][]).toString()}` : ""}`}>Reports</SecondaryLink>
          <ButtonLink href="/ledger/new">New transaction</ButtonLink>
        </>}
        description="A simple record of money coming in and going out. This is operational record-keeping, not an accounting system."
        title="Ledger"
      />
      <section aria-label="Summary" className="mb-5 grid gap-3 md:grid-cols-4">
        {summary.length === 0 ? <p className="text-sm text-[color:var(--muted)] md:col-span-4">No recorded activity matches these filters.</p> : null}
        {summary.map((row) => (
          <div className="contents" key={row.currency}>
            <div className="metric" data-tone="plain"><p className="metric-label">Income ({row.currency})</p><p className="metric-value">{formatDecimal(row.income)}</p></div>
            <div className="metric" data-tone="plain"><p className="metric-label">Expenses ({row.currency})</p><p className="metric-value">{formatDecimal(row.expense)}</p></div>
            <div className="metric" data-tone="plain"><p className="metric-label">Adjustments ({row.currency})</p><p className="metric-value">{formatDecimal(row.adjustments)}</p></div>
            <div className="metric" data-tone="brand"><p className="metric-label">Net recorded activity ({row.currency})</p><p className="metric-value">{formatDecimal(row.net)}</p></div>
          </div>
        ))}
        <p className="text-xs text-[color:var(--muted)] md:col-span-4">
          Net recorded activity = income − expenses ± adjustments for the entries shown by the date range and filters, excluding voided entries. It is not profit: costs or revenue that were never recorded here are not included.
        </p>
      </section>
      <form className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
        <input aria-label="Search" className={inputClass} defaultValue={filters.q} name="q" placeholder="Search description, reference, number, notes" />
        <input aria-label="From date" className={inputClass} defaultValue={filters.from} name="from" type="date" />
        <input aria-label="To date" className={inputClass} defaultValue={filters.to} name="to" type="date" />
        <select aria-label="Type" className={inputClass} defaultValue={filters.type ?? ""} name="type"><option value="">All types</option>{LEDGER_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select>
        <select aria-label="Category" className={inputClass} defaultValue={filters.categoryId ?? ""} name="category"><option value="">All categories</option>{options.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select aria-label="Client" className={inputClass} defaultValue={filters.clientId ?? ""} name="client"><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select aria-label="Project" className={inputClass} defaultValue={filters.projectId ?? ""} name="project"><option value="">All projects</option>{projects.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <label className="flex items-center gap-2 text-sm"><input defaultChecked={filters.includeVoided} name="voided" type="checkbox" value="1" /> Show voided</label>
        {filters.rentalId ? <input name="rental" type="hidden" value={filters.rentalId} /> : null}
        {filters.invoiceId ? <input name="invoice" type="hidden" value={filters.invoiceId} /> : null}
        <div className="flex gap-2"><button className="cal-btn cal-btn-primary" type="submit">Filter</button><Link className="cal-btn" href="/ledger">Reset</Link></div>
      </form>
      <DataTable columns={[{ label: "Date" }, { label: "Type" }, { label: "Description" }, { label: "Category" }, { label: "Client" }, { label: "Project" }, { label: "Amount", align: "right" }, { label: "Reference" }]} empty={list.rows.length ? undefined : "No transactions match these filters."}>
        {list.rows.map((row) => (
          <tr className={`${rowClass} ${row.voidedAt ? "opacity-60" : ""}`} key={row.id}>
            <td className="p-3 whitespace-nowrap">{formatDayKey(dateKeyUtc(row.transactionDate), { month: "short", day: "numeric", year: "numeric" })}</td>
            <td className="p-3"><StatusBadge status={row.type} />{row.voidedAt ? <span className="ml-1 badge" data-tone="bad">void</span> : null}</td>
            <td className="p-3"><Link className="font-semibold text-[color:var(--accent)]" href={`/ledger/${row.id}`}>{row.description}</Link><span className="block text-xs text-[color:var(--muted)]">{row.transactionNumber}</span></td>
            <td className="p-3">{row.category?.name ?? "—"}</td>
            <td className="p-3">{row.client?.name ?? "—"}</td>
            <td className="p-3">{row.project?.name ?? "—"}</td>
            <td className={`p-3 text-right font-semibold tabular-nums ${row.voidedAt ? "line-through" : ""}`}>{row.type === "EXPENSE" ? "−" : ""}{formatDecimal(row.amount)} <span className="text-xs font-normal text-[color:var(--muted)]">{row.currency}</span></td>
            <td className="p-3">{row.reference ?? "—"}</td>
          </tr>
        ))}
      </DataTable>
      <Pager basePath="/ledger" page={list.page} pageSize={LEDGER_PAGE_SIZE} pages={list.pages} params={pagerParams} total={list.total} />
      {!canManageLedger(user) ? <p className="mt-4 text-xs text-[color:var(--muted)]">Showing only entries tied to invoices and projects you manage.</p> : null}
    </>
  );
}
