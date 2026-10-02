import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DataTable, rowClass } from "@/components/data-table";
import { ButtonLink, inputClass, Notice, StatusBadge } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { dateKeyUtc, formatDateTimeInZone, formatDayKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { canReportIssue, getMaintenancePolicy } from "@/modules/maintenance/authorization";
import { listOpenRecords, listRecentCompleted, loadDueItems, parseMaintenanceFilters } from "@/modules/maintenance/data";
import { DueBadge } from "@/modules/maintenance/ui";
import { STATUSES, TYPES, TYPE_LABELS } from "@/modules/maintenance/validation";

export const dynamic = "force-dynamic";

const label = (value: string) => value.toLowerCase().replaceAll("_", " ");

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAuthenticatedUser();
  const params = await searchParams;
  const filters = parseMaintenanceFilters(params);
  const [zone, policy] = await Promise.all([getViewerTimeZone(user), getMaintenancePolicy(user.organizationId)]);
  const [open, due, recent, equipment, categories] = await Promise.all([
    listOpenRecords(user, filters),
    loadDueItems(user, policy, filters, zone),
    listRecentCompleted(user, filters),
    prisma.equipment.findMany({ where: { organizationId: user.organizationId, active: true }, select: { id: true, assetNumber: true, name: true }, orderBy: { assetNumber: "asc" }, take: 500 }),
    prisma.equipmentCategory.findMany({ where: { organizationId: user.organizationId }, orderBy: { name: "asc" } }),
  ]);
  const attention = due.filter((item) => item.due.state !== "OK" && (!filters.due || item.due.state === filters.due));
  const overdue = attention.filter((i) => i.due.state === "OVERDUE");
  const soon = attention.filter((i) => i.due.state !== "OVERDUE");
  const showClosed = !filters.status || filters.status === "COMPLETED" || filters.status === "CANCELLED";
  const showOpen = !filters.status || !["COMPLETED", "CANCELLED"].includes(filters.status);
  const dueTable = (items: typeof due, empty: string) => (
    <DataTable columns={[{ label: "Equipment" }, { label: "Service" }, { label: "Next due" }, { label: "Meter" }, { label: "State" }, { label: "Why" }, { label: "" }]} empty={items.length ? undefined : empty}>
      {items.map((item) => (
        <tr className={rowClass} key={item.id}>
          <td className="p-3"><Link className="font-semibold text-[color:var(--accent)]" href={`/rentals/equipment/${item.equipmentId}`}>{item.assetNumber}</Link><span className="block text-xs text-[color:var(--muted)]">{item.equipmentName}</span></td>
          <td className="p-3">{item.title ?? TYPE_LABELS[item.type as keyof typeof TYPE_LABELS]}</td>
          <td className="p-3 whitespace-nowrap">{item.nextServiceDate ? formatDayKey(dateKeyUtc(item.nextServiceDate), { month: "short", day: "numeric", year: "numeric" }) : "—"}</td>
          <td className="p-3">{item.nextServiceMeter ? `${item.currentMeter ?? "?"} / ${item.nextServiceMeter} ${item.meterUnit?.toLowerCase() ?? ""}` : "—"}</td>
          <td className="p-3"><DueBadge state={item.due.state} /></td>
          <td className="p-3 text-xs text-[color:var(--muted)]">{item.due.reasons.join("; ")}</td>
          <td className="p-3"><Link className="text-[color:var(--accent)] underline" href={`/maintenance/new?equipment=${item.equipmentId}&schedule=${item.id}`}>Open work</Link></td>
        </tr>
      ))}
    </DataTable>
  );
  return (
    <>
      <PageHeader
        actions={canReportIssue(user, policy) ? <ButtonLink href="/maintenance/new">{user.role === "EMPLOYEE" ? "Report an issue" : "New maintenance record"}</ButtonLink> : undefined}
        description="Whether equipment is serviceable, what work is open, and what service is coming due. Rentals track who has an asset; maintenance tracks its condition."
        title="Maintenance"
      />
      <Notice message={typeof params.success === "string" ? params.success : undefined} tone="success" />
      <form className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <select aria-label="Equipment" className={inputClass} defaultValue={filters.equipment ?? ""} name="equipment"><option value="">All equipment</option>{equipment.map((e) => <option key={e.id} value={e.id}>{e.assetNumber} — {e.name}</option>)}</select>
        <select aria-label="Category" className={inputClass} defaultValue={filters.category ?? ""} name="category"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select aria-label="Type" className={inputClass} defaultValue={filters.type ?? ""} name="type"><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</select>
        <select aria-label="Status" className={inputClass} defaultValue={filters.status ?? ""} name="status"><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select>
        <select aria-label="Due state" className={inputClass} defaultValue={filters.due ?? ""} name="due"><option value="">Any due state</option><option value="DUE_SOON">Due soon</option><option value="DUE">Due</option><option value="OVERDUE">Overdue</option></select>
        <div className="flex gap-2"><button className="cal-btn cal-btn-primary" type="submit">Filter</button><Link className="cal-btn" href="/maintenance">Reset</Link></div>
      </form>

      {showOpen ? (
        <section aria-labelledby="open-work" className="mb-8">
          <h2 className="mb-2 text-base font-semibold" id="open-work">Open work ({open.length})</h2>
          <DataTable columns={[{ label: "Equipment" }, { label: "Type" }, { label: "Description" }, { label: "Status" }, { label: "Equipment status" }, { label: "Assigned" }, { label: "Opened" }]} empty={open.length ? undefined : "No open maintenance work."}>
            {open.map((r) => (
              <tr className={rowClass} key={r.id}>
                <td className="p-3"><span className="font-semibold">{r.equipment.assetNumber}</span><span className="block text-xs text-[color:var(--muted)]">{r.equipment.name}</span></td>
                <td className="p-3">{TYPE_LABELS[r.type]}</td>
                <td className="p-3"><Link className="font-semibold text-[color:var(--accent)]" href={`/maintenance/${r.id}`}>{r.description.slice(0, 90)}</Link></td>
                <td className="p-3"><StatusBadge status={r.status} /></td>
                <td className="p-3"><StatusBadge status={r.equipment.status} /></td>
                <td className="p-3">{r.performedBy ? `${r.performedBy.firstName} ${r.performedBy.lastName}` : r.vendorName ?? "—"}</td>
                <td className="p-3 whitespace-nowrap">{formatDateTimeInZone(r.openedAt, zone)}</td>
              </tr>
            ))}
          </DataTable>
        </section>
      ) : null}
      {!filters.status || showOpen ? (
        <>
          <section aria-labelledby="overdue" className="mb-8"><h2 className="mb-2 text-base font-semibold" id="overdue">Overdue ({overdue.length})</h2>{dueTable(overdue, "Nothing is overdue.")}</section>
          <section aria-labelledby="due-soon" className="mb-8"><h2 className="mb-2 text-base font-semibold" id="due-soon">Due soon ({soon.length})</h2>{dueTable(soon, `Nothing is due within ${policy.dueSoonDays} days.`)}</section>
        </>
      ) : null}
      {showClosed ? (
        <section aria-labelledby="recent" className="mb-8">
          <h2 className="mb-2 text-base font-semibold" id="recent">Recently closed (last 60 days)</h2>
          <DataTable columns={[{ label: "Equipment" }, { label: "Type" }, { label: "Work" }, { label: "Status" }, { label: "Closed" }]} empty={recent.length ? undefined : "Nothing closed recently."}>
            {recent.map((r) => (
              <tr className={rowClass} key={r.id}>
                <td className="p-3 font-semibold">{r.equipment.assetNumber}</td><td className="p-3">{TYPE_LABELS[r.type]}</td>
                <td className="p-3"><Link className="text-[color:var(--accent)] underline" href={`/maintenance/${r.id}`}>{(r.workPerformed ?? r.description).slice(0, 90)}</Link></td>
                <td className="p-3"><StatusBadge status={r.status} /></td><td className="p-3 whitespace-nowrap">{r.completedAt ? formatDateTimeInZone(r.completedAt, zone) : "—"}</td>
              </tr>
            ))}
          </DataTable>
        </section>
      ) : null}
    </>
  );
}
