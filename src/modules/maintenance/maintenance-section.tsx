import Link from "next/link";
import { StatusBadge } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { dateKeyUtc, formatDayKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { formatName } from "@/lib/format";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { recordMeterAction, saveScheduleAction, setMeterUnit } from "./actions";
import { canManageMaintenance, canReportIssue, canSeeMaintenanceCost, getMaintenancePolicy } from "./authorization";
import { latestMeters, loadDueItems } from "./data";
import { findRentalConflicts } from "./rental-conflicts";
import { ConflictList, DueBadge } from "./ui";
import { TYPE_LABELS, TYPES } from "./validation";
import { inputClass } from "@/components/ui";

/** Maintenance block for the equipment detail page: current state, open work, schedules, meter and history. */
export async function MaintenanceSection({ equipmentId }: { equipmentId: string }) {
  const user = await requireAuthenticatedUser();
  const [policy, zone] = await Promise.all([getMaintenancePolicy(user.organizationId), getViewerTimeZone(user)]);
  const equipment = await prisma.equipment.findFirst({ where: { id: equipmentId, organizationId: user.organizationId }, select: { id: true, status: true, meterUnit: true } });
  if (!equipment) return null;
  const manager = canManageMaintenance(user, policy);
  const [records, due, meters, schedules, employees, conflicts, documents] = await Promise.all([
    prisma.maintenanceRecord.findMany({ where: { organizationId: user.organizationId, equipmentId }, orderBy: { openedAt: "desc" }, take: 25, include: { performedBy: { select: { firstName: true, lastName: true } } } }),
    loadDueItems(user, policy, { equipment: equipmentId }, zone),
    latestMeters(user.organizationId, [equipmentId]),
    prisma.maintenanceSchedule.findMany({ where: { organizationId: user.organizationId, equipmentId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] }),
    manager ? prisma.employee.findMany({ where: { organizationId: user.organizationId, employmentStatus: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 500 }) : [],
    equipment.status === "MAINTENANCE" || equipment.status === "OUT_OF_SERVICE" ? findRentalConflicts(prisma, user.organizationId, equipmentId) : [],
    prisma.document.findMany({ where: { organizationId: user.organizationId, status: "ACTIVE", relations: { some: { maintenanceRecord: { equipmentId } } } }, orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, title: true } }),
  ]);
  const open = records.filter((r) => ["OPEN", "IN_PROGRESS", "AWAITING_PARTS"].includes(r.status));
  const lastDone = records.find((r) => r.status === "COMPLETED");
  const nextDue = [...due].sort((a, b) => (a.nextServiceDate?.getTime() ?? Infinity) - (b.nextServiceDate?.getTime() ?? Infinity))[0];
  const meter = meters.get(equipmentId);
  const showCost = canSeeMaintenanceCost(user);
  const unit = equipment.meterUnit?.toLowerCase();
  return (
    <section className="mt-5 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5" id="maintenance">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Maintenance</h2>
        {canReportIssue(user, policy) ? <Link className="text-sm font-semibold text-[color:var(--accent)]" href={`/maintenance/new?equipment=${equipmentId}`}>{manager ? "New maintenance record" : "Report an issue"}</Link> : null}
      </div>
      <ConflictList conflicts={conflicts} zone={zone} />
      <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-4">
        <div><dt className="font-semibold">Serviceability</dt><dd><StatusBadge status={equipment.status} /></dd></div>
        <div><dt className="font-semibold">Open work</dt><dd>{open.length ? open.map((r) => <Link className="block text-[color:var(--accent)] underline" href={`/maintenance/${r.id}`} key={r.id}>{TYPE_LABELS[r.type]}: {r.description.slice(0, 40)}</Link>) : "None"}</dd></div>
        <div><dt className="font-semibold">Last completed</dt><dd>{lastDone?.completedAt ? <Link className="text-[color:var(--accent)] underline" href={`/maintenance/${lastDone.id}`}>{formatDayKey(dateKeyUtc(lastDone.completedAt), { month: "short", day: "numeric", year: "numeric" })}</Link> : "—"}</dd></div>
        <div><dt className="font-semibold">Next scheduled service</dt><dd>{nextDue ? <>{nextDue.nextServiceDate ? formatDayKey(dateKeyUtc(nextDue.nextServiceDate), { month: "short", day: "numeric", year: "numeric" }) : `at ${nextDue.nextServiceMeter} ${unit ?? ""}`} <DueBadge state={nextDue.due.state} /></> : "Nothing scheduled"}</dd></div>
      </dl>
      {equipment.meterUnit ? <p className="mb-3 text-sm">Meter: <strong>{meter ? `${meter.toFixed(1)} ${unit}` : "no reading yet"}</strong></p> : null}

      <h3 className="mb-1 text-sm font-semibold">Service schedules</h3>
      {schedules.length === 0 ? <p className="mb-2 text-sm text-[color:var(--muted)]">No recurring service is scheduled for this asset.</p> : null}
      <ul className="mb-3 grid gap-2">
        {schedules.map((s) => {
          const item = due.find((d) => d.id === s.id);
          return (
            <li className="rounded-sm border border-[color:var(--border)] p-3 text-sm" key={s.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><strong>{s.title ?? TYPE_LABELS[s.type]}</strong> · {TYPE_LABELS[s.type]}{s.active ? "" : " · inactive"} · every {[s.intervalMonths ? `${s.intervalMonths} mo` : s.intervalDays ? `${s.intervalDays} d` : null, s.intervalMeter ? `${s.intervalMeter.toFixed(1)} ${unit ?? ""}` : null].filter(Boolean).join(" / ") || "—"}</span>
                {item ? <DueBadge state={item.due.state} /> : null}
              </div>
              <p className="text-xs text-[color:var(--muted)]">Last {s.lastServiceDate ? dateKeyUtc(s.lastServiceDate) : "—"} · next {s.nextServiceDate ? dateKeyUtc(s.nextServiceDate) : "—"}{s.nextServiceMeter ? ` / ${s.nextServiceMeter.toFixed(1)} ${unit ?? ""}` : ""}</p>
              {manager ? <ScheduleForm employees={employees} equipmentId={equipmentId} hasMeter={Boolean(equipment.meterUnit)} schedule={s} /> : null}
            </li>
          );
        })}
      </ul>
      {manager ? (
        <details className="mb-4 rounded-sm border border-[color:var(--border)] p-3">
          <summary className="cursor-pointer text-sm font-semibold">Add a service schedule</summary>
          <ScheduleForm employees={employees} equipmentId={equipmentId} hasMeter={Boolean(equipment.meterUnit)} />
        </details>
      ) : null}

      {manager ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <form action={setMeterUnit} className="flex items-end gap-2 text-sm">
            <input name="equipmentId" type="hidden" value={equipmentId} />
            <label className="grid gap-1 text-xs font-semibold">Usage meter<select className={inputClass} defaultValue={equipment.meterUnit ?? ""} name="meterUnit"><option value="">Not tracked</option><option value="HOURS">Hours</option><option value="MILES">Miles</option><option value="CYCLES">Cycles</option></select></label>
            <button className="notif-btn" type="submit">Save</button>
          </form>
          {equipment.meterUnit ? (
            <form action={recordMeterAction} className="flex items-end gap-2 text-sm">
              <input name="equipmentId" type="hidden" value={equipmentId} />
              <label className="grid gap-1 text-xs font-semibold">New reading ({unit})<input className={inputClass} inputMode="decimal" name="reading" required /></label>
              <button className="notif-btn" type="submit">Record</button>
            </form>
          ) : null}
        </div>
      ) : null}

      <h3 className="mb-1 text-sm font-semibold">History</h3>
      {records.length === 0 ? <p className="text-sm text-[color:var(--muted)]">No maintenance has been recorded.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-[color:var(--border)] text-xs uppercase text-[color:var(--muted)]"><th className="p-2">Opened</th><th className="p-2">Type</th><th className="p-2">Work</th><th className="p-2">Status</th><th className="p-2">By</th>{showCost ? <th className="p-2 text-right">Cost</th> : null}</tr></thead>
            <tbody>
              {records.map((r) => (
                <tr className="border-b border-[color:var(--border)] last:border-0" key={r.id}>
                  <td className="p-2 whitespace-nowrap">{dateKeyUtc(r.openedAt)}</td><td className="p-2">{TYPE_LABELS[r.type]}</td>
                  <td className="p-2"><Link className="text-[color:var(--accent)] underline" href={`/maintenance/${r.id}`}>{(r.workPerformed ?? r.description).slice(0, 70)}</Link></td>
                  <td className="p-2"><StatusBadge status={r.status} /></td><td className="p-2">{r.performedBy ? formatName(r.performedBy) : r.vendorName ?? "—"}</td>
                  {showCost ? <td className="p-2 text-right tabular-nums">{r.cost ? r.cost.toFixed(2) : "—"}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {documents.length ? <p className="mt-3 text-sm">Maintenance documents: {documents.map((d) => <Link className="mr-2 text-[color:var(--accent)] underline" href={`/documents/${d.id}`} key={d.id}>{d.title}</Link>)}</p> : null}
    </section>
  );
}

function ScheduleForm({ equipmentId, schedule, employees, hasMeter }: {
  equipmentId: string; hasMeter: boolean; employees: Array<{ id: string; firstName: string; preferredName: string | null; lastName: string; suffix: string | null }>;
  schedule?: { id: string; type: string; title: string | null; intervalDays: number | null; intervalMonths: number | null; intervalMeter: { toFixed(n: number): string } | null; lastServiceDate: Date | null; lastServiceMeter: { toFixed(n: number): string } | null; nextServiceDate: Date | null; nextServiceMeter: { toFixed(n: number): string } | null; responsibleEmployeeId: string | null; active: boolean };
}) {
  return (
    <form action={saveScheduleAction} className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <input name="equipmentId" type="hidden" value={equipmentId} />
      {schedule ? <input name="id" type="hidden" value={schedule.id} /> : null}
      <label className="grid gap-1 text-xs font-semibold">Service<select className={inputClass} defaultValue={schedule?.type ?? "PREVENTIVE"} name="type">{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-semibold">Name<input className={inputClass} defaultValue={schedule?.title ?? ""} maxLength={120} name="title" placeholder="e.g. Annual inspection" /></label>
      <label className="grid gap-1 text-xs font-semibold">Every (months)<input className={inputClass} defaultValue={schedule?.intervalMonths ?? ""} min={1} name="intervalMonths" type="number" /></label>
      <label className="grid gap-1 text-xs font-semibold">or every (days)<input className={inputClass} defaultValue={schedule?.intervalDays ?? ""} min={1} name="intervalDays" type="number" /></label>
      {hasMeter ? <label className="grid gap-1 text-xs font-semibold">Every (meter)<input className={inputClass} defaultValue={schedule?.intervalMeter?.toFixed(1) ?? ""} inputMode="decimal" name="intervalMeter" /></label> : null}
      <label className="grid gap-1 text-xs font-semibold">Last serviced<input className={inputClass} defaultValue={schedule?.lastServiceDate ? dateKeyUtc(schedule.lastServiceDate) : ""} name="lastServiceDate" type="date" /></label>
      {hasMeter ? <label className="grid gap-1 text-xs font-semibold">Last service meter<input className={inputClass} defaultValue={schedule?.lastServiceMeter?.toFixed(1) ?? ""} inputMode="decimal" name="lastServiceMeter" /></label> : null}
      <label className="grid gap-1 text-xs font-semibold">Next due (date)<input className={inputClass} defaultValue={schedule?.nextServiceDate ? dateKeyUtc(schedule.nextServiceDate) : ""} name="nextServiceDate" type="date" /></label>
      {hasMeter ? <label className="grid gap-1 text-xs font-semibold">Next due (meter)<input className={inputClass} defaultValue={schedule?.nextServiceMeter?.toFixed(1) ?? ""} inputMode="decimal" name="nextServiceMeter" /></label> : null}
      <label className="grid gap-1 text-xs font-semibold">Responsible<select className={inputClass} defaultValue={schedule?.responsibleEmployeeId ?? ""} name="responsibleEmployeeId"><option value="">Administrators</option>{employees.map((e) => <option key={e.id} value={e.id}>{formatName(e)}</option>)}</select></label>
      {schedule ? <label className="grid gap-1 text-xs font-semibold">Status<select className={inputClass} defaultValue={String(schedule.active)} name="active"><option value="true">Active</option><option value="false">Inactive</option></select></label> : null}
      <button className="cal-btn self-end" type="submit">{schedule ? "Save schedule" : "Add schedule"}</button>
      <p className="text-xs text-[color:var(--muted)] sm:col-span-3 lg:col-span-6">Leave “next due” empty to calculate it from the last service and the interval.</p>
    </form>
  );
}
