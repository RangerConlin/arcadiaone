import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DataTable, Pager, rowClass } from "@/components/data-table";
import { inputClass } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { formatDateTimeInZone } from "@/lib/datetime";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/modules/audit/actions";
import { AUDIT_PAGE_SIZE, listAuditEvents, parseAuditFilters } from "@/modules/audit/data";

export const dynamic = "force-dynamic";

const actionGroups = [...new Set(Object.values(AUDIT_ACTIONS).map((a) => a.split(".")[0]))];

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole("ADMIN");
  const filters = parseAuditFilters(await searchParams);
  const zone = await getViewerTimeZone(user);
  const list = await listAuditEvents(user, filters, zone);
  const pagerParams: Record<string, string | undefined> = { from: filters.from, to: filters.to, actor: filters.actor, action: filters.action, entityType: filters.entityType, entityId: filters.entityId, q: filters.q, outcome: filters.outcome };
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Administration", href: "/administration" }, { label: "Audit log" }]}
        description={`An append-only record of security and business-critical actions. Times are shown in ${zone}. Events cannot be edited or deleted from the application.`}
        title="Audit log"
      />
      <form className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
        <input aria-label="Search summary" className={inputClass} defaultValue={filters.q} name="q" placeholder="Search summary" />
        <input aria-label="Actor" className={inputClass} defaultValue={filters.actor} name="actor" placeholder="Actor (email)" />
        <input aria-label="From date" className={inputClass} defaultValue={filters.from} name="from" type="date" />
        <input aria-label="To date" className={inputClass} defaultValue={filters.to} name="to" type="date" />
        <select aria-label="Action" className={inputClass} defaultValue={filters.action ?? ""} name="action">
          <option value="">All actions</option>
          {actionGroups.map((group) => <optgroup key={group} label={group}>
            <option value={group}>All {group} actions</option>
            {Object.values(AUDIT_ACTIONS).filter((a) => a.startsWith(`${group}.`)).map((a) => <option key={a} value={a}>{a}</option>)}
          </optgroup>)}
        </select>
        <select aria-label="Entity type" className={inputClass} defaultValue={filters.entityType ?? ""} name="entityType">
          <option value="">All entity types</option>{AUDIT_ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select aria-label="Outcome" className={inputClass} defaultValue={filters.outcome ?? ""} name="outcome">
          <option value="">Any outcome</option><option value="SUCCESS">Success</option><option value="FAILURE">Failure</option>
        </select>
        {filters.entityId ? <input name="entityId" type="hidden" value={filters.entityId} /> : null}
        <div className="flex gap-2"><button className="cal-btn cal-btn-primary" type="submit">Filter</button><Link className="cal-btn" href="/administration/audit">Reset</Link></div>
      </form>
      {filters.entityId ? <p className="mb-3 text-sm text-[color:var(--muted)]">Showing history for one record. <Link className="underline" href="/administration/audit">Clear</Link></p> : null}
      <DataTable columns={[{ label: "Time" }, { label: "Actor" }, { label: "Action" }, { label: "Entity" }, { label: "Summary" }]} empty={list.rows.length ? undefined : "No audit events match these filters."}>
        {list.rows.map((event) => (
          <tr className={rowClass} key={event.id}>
            <td className="p-3 whitespace-nowrap"><Link className="text-[color:var(--accent)] underline" href={`/administration/audit/${event.id}`}>{formatDateTimeInZone(event.occurredAt, zone)}</Link></td>
            <td className="p-3">{event.actorLabel ?? <span className="text-[color:var(--muted)]">System</span>}{event.actorPortalUserId ? <span className="ml-1 badge" data-tone="info">portal</span> : null}</td>
            <td className="p-3"><code className="text-xs">{event.action}</code>{event.outcome === "FAILURE" ? <span className="ml-1 badge" data-tone="bad">failed</span> : null}</td>
            <td className="p-3">{event.entityType}</td>
            <td className="p-3">{event.summary}</td>
          </tr>
        ))}
      </DataTable>
      <Pager basePath="/administration/audit" page={list.page} pageSize={AUDIT_PAGE_SIZE} pages={list.pages} params={pagerParams} total={list.total} />
    </>
  );
}
