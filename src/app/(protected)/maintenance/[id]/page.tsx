import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentSection } from "@/components/document-section";
import { PageHeader } from "@/components/page-header";
import { Field, inputClass, Notice, SecondaryLink, StatusBadge } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { dateKeyUtc, formatDateTimeInZone, formatDayKey } from "@/lib/datetime";
import { formatName } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { attachMaintenanceDocument, cancelMaintenance, changeMaintenanceStatus, completeMaintenance, placeEquipmentAction, postMaintenanceCost } from "@/modules/maintenance/actions";
import { canManageMaintenance, canPostCostToLedger, canSeeMaintenanceCost, getMaintenancePolicy } from "@/modules/maintenance/authorization";
import { findRentalConflicts } from "@/modules/maintenance/rental-conflicts";
import { ConflictList } from "@/modules/maintenance/ui";
import { CONDITIONS, TYPE_LABELS } from "@/modules/maintenance/validation";
import { formatMoney } from "@/modules/ledger/money";

export const dynamic = "force-dynamic";

const label = (value: string) => value.toLowerCase().replaceAll("_", " ");

export default async function MaintenanceDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ success?: string; error?: string }> }) {
  const [user, { id }, query] = await Promise.all([requireAuthenticatedUser(), params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const record = await prisma.maintenanceRecord.findFirst({
    where: { id, organizationId: user.organizationId },
    include: { equipment: { include: { category: true } }, performedBy: true, createdBy: { select: { email: true } }, ledgerTransaction: { select: { id: true } }, schedule: true },
  });
  if (!record) notFound();
  const [zone, policy] = await Promise.all([getViewerTimeZone(user), getMaintenancePolicy(user.organizationId)]);
  const manager = canManageMaintenance(user, policy);
  const closed = record.status === "COMPLETED" || record.status === "CANCELLED";
  const eq = record.equipment;
  const unavailable = eq.status === "MAINTENANCE" || eq.status === "OUT_OF_SERVICE";
  const [conflicts, employees] = await Promise.all([
    !closed && (unavailable || record.equipmentStatusApplied) ? findRentalConflicts(prisma, user.organizationId, eq.id) : [],
    manager && !closed ? prisma.employee.findMany({ where: { organizationId: user.organizationId, employmentStatus: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 500 }) : [],
  ]);
  const showCost = canSeeMaintenanceCost(user);
  return (
    <>
      <PageHeader
        actions={<>
          {user.role === "ADMIN" ? <SecondaryLink href={`/administration/audit?entityType=MaintenanceRecord&entityId=${record.id}`}>Audit history</SecondaryLink> : null}
          <SecondaryLink href={`/rentals/equipment/${eq.id}`}>Equipment page</SecondaryLink>
        </>}
        breadcrumbs={[{ label: "Maintenance", href: "/maintenance" }, { label: eq.assetNumber }]}
        title={`${TYPE_LABELS[record.type]} — ${eq.assetNumber} ${eq.name}`}
      />
      <Notice message={query.success} tone="success" />
      <Notice message={query.error} tone="error" />
      <ConflictList conflicts={conflicts} zone={zone} />
      <section className="mb-6 max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2"><StatusBadge status={record.status} /><span className="text-sm">Equipment is currently</span><StatusBadge status={eq.status} /><StatusBadge status={eq.condition} /></div>
        {record.equipmentStatusApplied && !record.returnedToServiceAt ? <p className="mb-3 text-sm">This record took the equipment out of service on {record.unavailableAt ? formatDateTimeInZone(record.unavailableAt, zone) : "—"}. It stays that way until someone explicitly returns it to service.</p> : null}
        <p className="whitespace-pre-wrap text-sm">{record.description}</p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold">Opened</dt><dd>{formatDateTimeInZone(record.openedAt, zone)} by {record.createdBy.email}</dd></div>
          <div><dt className="font-semibold">Assigned</dt><dd>{record.performedBy ? formatName(record.performedBy) : record.vendorName ?? "Nobody yet"}</dd></div>
          {record.completedAt ? <div><dt className="font-semibold">{record.status === "CANCELLED" ? "Cancelled" : "Completed"}</dt><dd>{formatDateTimeInZone(record.completedAt, zone)}</dd></div> : null}
          {record.returnedToServiceAt ? <div><dt className="font-semibold">Returned to service</dt><dd>{formatDateTimeInZone(record.returnedToServiceAt, zone)}</dd></div> : null}
          {record.inspectionResult ? <div><dt className="font-semibold">Inspection result</dt><dd>{label(record.inspectionResult)}{record.conditionFound ? ` · found ${label(record.conditionFound)}` : ""}</dd></div> : null}
          {record.meterReading ? <div><dt className="font-semibold">Meter</dt><dd>{record.meterReading.toFixed(1)} {eq.meterUnit?.toLowerCase()}</dd></div> : null}
          {showCost && record.cost ? <div><dt className="font-semibold">Cost</dt><dd>{formatMoney(record.cost, "USD")}{record.ledgerTransaction ? <> · <Link className="underline" href={`/ledger/${record.ledgerTransaction.id}`}>ledger entry</Link></> : " · not in the ledger"}</dd></div> : null}
          {record.nextServiceDate || record.nextServiceMeter ? <div><dt className="font-semibold">Next service</dt><dd>{record.nextServiceDate ? formatDayKey(dateKeyUtc(record.nextServiceDate)) : ""}{record.nextServiceMeter ? ` · at ${record.nextServiceMeter.toFixed(1)} ${eq.meterUnit?.toLowerCase() ?? ""}` : ""}</dd></div> : null}
        </dl>
        {record.workPerformed ? <div className="mt-4"><h2 className="text-sm font-semibold">Work performed</h2><p className="whitespace-pre-wrap text-sm">{record.workPerformed}</p></div> : null}
        {record.notes ? <p className="mt-3 whitespace-pre-wrap text-sm text-[color:var(--muted)]">{record.notes}</p> : null}
        {record.status === "COMPLETED" && record.cost && canPostCostToLedger(user) && !record.ledgerTransaction ? (
          <form action={postMaintenanceCost} className="mt-4"><input name="id" type="hidden" value={record.id} /><button className="cal-btn" type="submit">Record cost as a ledger expense</button></form>
        ) : null}
      </section>

      {manager && !closed ? (
        <>
          <section className="mb-6 grid max-w-4xl gap-4 sm:grid-cols-2">
            <form action={changeMaintenanceStatus} className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4">
              <input name="id" type="hidden" value={record.id} /><h2 className="mb-2 text-base font-semibold">Work status</h2>
              <div className="flex gap-2"><select aria-label="Work status" className={inputClass} defaultValue={record.status} name="status"><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="AWAITING_PARTS">Awaiting parts</option></select><button className="cal-btn" type="submit">Update</button></div>
            </form>
            <form action={placeEquipmentAction} className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4">
              <input name="id" type="hidden" value={record.id} /><h2 className="mb-2 text-base font-semibold">Take equipment out of rental</h2>
              <div className="flex gap-2"><select aria-label="Equipment status" className={inputClass} name="place"><option value="MAINTENANCE">Maintenance</option><option value="OUT_OF_SERVICE">Out of service</option></select><button className="cal-btn" type="submit">Apply</button></div>
              <p className="mt-1 text-xs text-[color:var(--muted)]">Affected rentals are listed above; none are reassigned.</p>
            </form>
          </section>
          <form action={completeMaintenance} className="mb-6 grid max-w-4xl gap-4 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
            <input name="id" type="hidden" value={record.id} />
            <h2 className="text-base font-semibold">Complete this work</h2>
            <Field label="Work performed"><textarea className={`${inputClass} min-h-24`} defaultValue={record.workPerformed ?? ""} maxLength={4000} name="workPerformed" required /></Field>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {record.type === "INSPECTION" ? <Field label="Inspection result"><select className={inputClass} name="inspectionResult" required><option value="">Choose…</option><option value="PASS">Pass</option><option value="FAIL">Fail</option></select></Field> : null}
              {record.type === "INSPECTION" ? <Field label="Condition found"><select className={inputClass} name="conditionFound"><option value="">No change</option>{CONDITIONS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></Field> : <Field label="Final condition"><select className={inputClass} defaultValue="" name="finalCondition"><option value="">No change ({label(eq.condition)})</option>{CONDITIONS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></Field>}
              {showCost ? <Field label="Cost (optional)"><input className={inputClass} inputMode="decimal" name="cost" placeholder="0.00" /></Field> : null}
              {eq.meterUnit ? <Field label={`Meter reading (${eq.meterUnit.toLowerCase()})`}><input className={inputClass} inputMode="decimal" name="meterReading" /></Field> : null}
              <Field label="Performed by"><select className={inputClass} defaultValue={record.performedByEmployeeId ?? ""} name="performedByEmployeeId"><option value="">—</option>{employees.map((e) => <option key={e.id} value={e.id}>{formatName(e)}</option>)}</select></Field>
              <Field label="Vendor"><input className={inputClass} defaultValue={record.vendorName ?? ""} maxLength={160} name="vendorName" /></Field>
              <Field label="Next service date"><input className={inputClass} defaultValue={record.schedule?.nextServiceDate ? dateKeyUtc(record.schedule.nextServiceDate) : ""} name="nextServiceDate" type="date" /></Field>
              {eq.meterUnit ? <Field label="Next service at meter"><input className={inputClass} inputMode="decimal" name="nextServiceMeter" /></Field> : null}
            </div>
            {record.schedule ? <p className="text-xs text-[color:var(--muted)]">Leave the next-service fields empty to calculate them from the schedule&apos;s interval.</p> : null}
            <Field label="Equipment status after this work (required)">
              <select className={inputClass} defaultValue="" name="postStatus" required>
                <option value="">Choose…</option>
                <option value="AVAILABLE">Return to service — available</option>
                <option value="MAINTENANCE">Keep in maintenance</option>
                <option value="OUT_OF_SERVICE">Keep / place out of service</option>
                <option value="KEEP">Leave the current status ({label(eq.status)})</option>
              </select>
            </Field>
            {canPostCostToLedger(user) ? <label className="flex items-center gap-2 text-sm"><input name="postCostToLedger" type="checkbox" /> Record the cost as a ledger expense{policy.autoPostCost ? " (this organization posts costs automatically)" : ""}</label> : null}
            <div><button className="cal-btn cal-btn-primary" type="submit">Complete maintenance</button></div>
          </form>
          <form action={cancelMaintenance} className="mb-6 grid max-w-4xl gap-3 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4 sm:grid-cols-[1fr_1fr_auto]">
            <input name="id" type="hidden" value={record.id} />
            <Field label="Cancel this record — reason"><input className={inputClass} maxLength={300} name="reason" /></Field>
            <Field label="Equipment status afterwards"><select className={inputClass} defaultValue="KEEP" name="postStatus"><option value="KEEP">Leave as is ({label(eq.status)})</option><option value="AVAILABLE">Return to service</option><option value="MAINTENANCE">Maintenance</option><option value="OUT_OF_SERVICE">Out of service</option></select></Field>
            <button className="cal-btn self-end" type="submit">Cancel record</button>
          </form>
        </>
      ) : null}

      <div className="max-w-4xl">
        <DocumentSection relationId={record.id} relationType="maintenanceRecordId" returnTo={`/maintenance/${record.id}`} />
        {manager || record.createdByUserId === user.id ? (
          <form action={attachMaintenanceDocument} className="mt-3 grid items-end gap-2 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4 sm:grid-cols-[1fr_1fr_auto]" encType="multipart/form-data">
            <input name="recordId" type="hidden" value={record.id} />
            <label className="grid gap-1 text-xs font-semibold">Title (invoice, certificate, photo…)<input className={inputClass} maxLength={200} name="title" required /></label>
            <label className="grid gap-1 text-xs font-semibold">File<input className={inputClass} name="file" required type="file" /></label>
            <button className="cal-btn" type="submit">Attach</button>
          </form>
        ) : null}
      </div>
    </>
  );
}
