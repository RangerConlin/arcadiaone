import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { DataTable, Pager, rowClass } from "@/components/data-table";
import { inputClass, Notice, SecondaryLink } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { formatDecimal } from "@/modules/ledger/money";
import { deleteReportFilter, saveReportFilter } from "@/modules/reports/actions";
import { filtersToQuery, hasFilters, parseReportFilters } from "@/modules/reports/filters";
import { loadFilterOptions } from "@/modules/reports/options";
import { getReport } from "@/modules/reports/registry";
import { prepareReport, runPrepared } from "@/modules/reports/run";
import { REPORT_PAGE_SIZE, type Cell, type Column } from "@/modules/reports/types";

export const dynamic = "force-dynamic";

const alignRight = (column: Column) => column.type === "money" || column.type === "number";
function display(cell: Cell, column: Column) {
  if (cell === null || cell === undefined || cell === "") return "—";
  return column.type === "money" ? formatDecimal(String(cell)) : String(cell);
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, { id }, query] = await Promise.all([requireAuthenticatedUser(), params, searchParams]);
  const prepared = await prepareReport(user, id, query);
  if (!prepared) {
    if (getReport(id)) return <ForbiddenReport />;
    notFound();
  }
  const { definition, filters, ctx } = prepared;
  const [result, options, saved] = await Promise.all([
    runPrepared(prepared),
    loadFilterOptions(user, definition),
    prisma.savedReportFilter.findMany({ where: { userId: user.id, organizationId: user.organizationId, reportId: id }, orderBy: { name: "asc" } }),
  ]);
  const baseQuery = filtersToQuery(filters);
  const wants = (key: (typeof definition.filters)[number]) => definition.filters.includes(key);
  const success = typeof query.success === "string" ? query.success : undefined;
  const error = typeof query.error === "string" ? query.error : undefined;
  const exportHref = (format: string) => `/reports/${id}/export?${[baseQuery, `format=${format}`].filter(Boolean).join("&")}`;
  const select = (name: string, value: string | undefined, all: string, items: Array<{ id: string; name: string }>) => (
    <label className="grid gap-1 text-xs font-semibold">{name === "qualificationType" ? "Qualification" : name.charAt(0).toUpperCase() + name.slice(1)}
      <select className={inputClass} defaultValue={value ?? ""} name={name}><option value="">{all}</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    </label>
  );
  return (
    <>
      <PageHeader
        actions={<>
          <SecondaryLink href={exportHref("csv")}>Export CSV</SecondaryLink>
          <SecondaryLink href={exportHref("xlsx")}>Export Excel</SecondaryLink>
        </>}
        breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: definition.title }]}
        description={definition.description}
        title={definition.title}
      />
      <Notice message={success} tone="success" />
      <Notice message={error} tone="error" />
      {definition.definition ? <p className="mb-4 max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-3 text-sm text-[color:var(--muted)]"><strong>How to read this:</strong> {definition.definition}</p> : null}
      {definition.filters.length ? (
        <form className="mb-4 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
          {wants("dateRange") ? <>
            <label className="grid gap-1 text-xs font-semibold">From<input className={inputClass} defaultValue={filters.from} name="from" type="date" /></label>
            <label className="grid gap-1 text-xs font-semibold">To<input className={inputClass} defaultValue={filters.to} name="to" type="date" /></label>
          </> : null}
          {wants("days") ? <label className="grid gap-1 text-xs font-semibold">Within days<input className={inputClass} defaultValue={filters.days ?? ""} max={730} min={1} name="days" placeholder={`${ctx.warningDays} (default)`} type="number" /></label> : null}
          {wants("status") && definition.statusOptions ? (
            <label className="grid gap-1 text-xs font-semibold">Status
              <select className={inputClass} defaultValue={filters.status ?? ""} name="status"><option value="">Any</option>{definition.statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            </label>
          ) : null}
          {wants("department") ? select("department", filters.department, "All departments", options.departments) : null}
          {wants("position") && options.positions.length ? select("position", filters.position, "All positions", options.positions) : null}
          {wants("employee") && options.employees.length ? select("employee", filters.employee, "Any employee", options.employees) : null}
          {wants("project") ? select("project", filters.project, "All projects", options.projects) : null}
          {wants("client") ? select("client", filters.client, "All clients", options.clients) : null}
          {wants("qualificationType") && options.qualificationTypes.length ? select("qualificationType", filters.qualificationType, "All qualifications", options.qualificationTypes) : null}
          <div className="flex gap-2"><button className="cal-btn cal-btn-primary" type="submit">Apply</button><Link className="cal-btn" href={`/reports/${id}`}>Reset</Link></div>
        </form>
      ) : null}
      {result.notes?.map((note) => <p className="mb-2 text-sm text-[color:var(--muted)]" key={note}>{note}</p>)}
      {result.summary?.length ? (
        <section aria-label="Summary" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {result.summary.map((item) => <div className="metric" data-tone="plain" key={item.label}><p className="metric-label">{item.label}</p><p className="metric-value">{item.money ? formatDecimal(item.value) : item.value}</p></div>)}
        </section>
      ) : null}
      <DataTable columns={result.columns.map((c) => ({ label: c.label, align: alignRight(c) ? "right" : undefined }))} empty={result.rows.length ? undefined : "No records match these filters."}>
        {result.rows.map((row, index) => (
          <tr className={rowClass} key={index}>
            {row.map((cell, i) => <td className={`p-3 ${alignRight(result.columns[i]) ? "text-right tabular-nums" : ""}`} key={i}>{display(cell, result.columns[i])}</td>)}
          </tr>
        ))}
      </DataTable>
      <Pager
        basePath={`/reports/${id}`} page={ctx.page} pageSize={REPORT_PAGE_SIZE} pages={Math.max(1, Math.ceil(result.total / REPORT_PAGE_SIZE))} total={result.total}
        params={Object.fromEntries(new URLSearchParams(baseQuery).entries())}
      />
      <section className="mt-8 max-w-3xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4">
        <h2 className="text-sm font-semibold">Saved filters</h2>
        {saved.length ? (
          <ul className="mt-2 grid gap-1 text-sm">
            {saved.map((item) => (
              <li className="flex items-center justify-between gap-3" key={item.id}>
                <Link className="text-[color:var(--accent)] underline" href={`/reports/${id}?${filtersToQuery(parseReportFilters(definition, item.filters as Record<string, string>))}`}>{item.name}</Link>
                <form action={deleteReportFilter}><input name="id" type="hidden" value={item.id} /><input name="reportId" type="hidden" value={id} /><button className="notif-btn" type="submit">Remove</button></form>
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-sm text-[color:var(--muted)]">None yet.</p>}
        {definition.filters.length ? (
          <form action={saveReportFilter} className="mt-3 flex flex-wrap items-end gap-2">
            <input name="reportId" type="hidden" value={id} />
            <input name="query" type="hidden" value={baseQuery} />
            <label className="grid gap-1 text-xs font-semibold">Save the current filters as<input className={inputClass} maxLength={60} name="name" placeholder={hasFilters(filters) ? "Name" : "Name (no filters set)"} required /></label>
            <button className="cal-btn" type="submit">Save</button>
          </form>
        ) : null}
      </section>
    </>
  );
}

function ForbiddenReport() {
  return <p className="cal-empty-large">You do not have access to this report. <Link className="underline" href="/reports">Back to reports</Link></p>;
}
