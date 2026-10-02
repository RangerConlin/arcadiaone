import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Field, inputClass, Notice, SubmitButton } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { formatName } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { openMaintenance } from "@/modules/maintenance/actions";
import { canManageMaintenance, canReportIssue, getMaintenancePolicy } from "@/modules/maintenance/authorization";
import { findRentalConflicts } from "@/modules/maintenance/rental-conflicts";
import { ConflictList } from "@/modules/maintenance/ui";
import { TYPE_LABELS, TYPES } from "@/modules/maintenance/validation";

export const dynamic = "force-dynamic";

export default async function NewMaintenancePage({ searchParams }: { searchParams: Promise<{ error?: string; equipment?: string; schedule?: string }> }) {
  const user = await requireAuthenticatedUser();
  const policy = await getMaintenancePolicy(user.organizationId);
  if (!canReportIssue(user, policy)) redirect("/forbidden");
  const manager = canManageMaintenance(user, policy);
  const [query, zone] = await Promise.all([searchParams, getViewerTimeZone(user)]);
  const equipmentId = query.equipment && /^[0-9a-f-]{36}$/i.test(query.equipment) ? query.equipment : "";
  const [equipment, employees, schedule] = await Promise.all([
    prisma.equipment.findMany({ where: { organizationId: user.organizationId, active: true }, select: { id: true, assetNumber: true, name: true, status: true, meterUnit: true }, orderBy: { assetNumber: "asc" }, take: 500 }),
    manager ? prisma.employee.findMany({ where: { organizationId: user.organizationId, employmentStatus: "ACTIVE" }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 500 }) : [],
    query.schedule && equipmentId ? prisma.maintenanceSchedule.findFirst({ where: { id: query.schedule, equipmentId, organizationId: user.organizationId } }) : null,
  ]);
  const conflicts = equipmentId ? await findRentalConflicts(prisma, user.organizationId, equipmentId) : [];
  const types = manager ? TYPES : (["DAMAGE", "REPAIR", "OTHER"] as const);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Maintenance", href: "/maintenance" }, { label: manager ? "New record" : "Report an issue" }]}
        description={manager ? "Open work on an asset. Choose whether it should stop being rentable now; nothing returns to service automatically." : "Tell the maintenance team about a problem. You cannot change the equipment's status."}
        title={manager ? "New maintenance record" : "Report an issue"}
      />
      <Notice message={query.error} tone="error" />
      {equipmentId ? <ConflictList conflicts={conflicts} zone={zone} /> : null}
      <form action={openMaintenance} className="grid max-w-4xl gap-4 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        {schedule ? <input name="scheduleId" type="hidden" value={schedule.id} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Equipment"><select className={inputClass} defaultValue={equipmentId} name="equipmentId" required><option value="">Choose equipment</option>{equipment.map((e) => <option key={e.id} value={e.id}>{e.assetNumber} — {e.name} ({e.status.toLowerCase().replaceAll("_", " ")})</option>)}</select></Field>
          <Field label="Type"><select className={inputClass} defaultValue={schedule?.type ?? (manager ? "REPAIR" : "DAMAGE")} name="type">{types.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</select></Field>
        </div>
        <Field label={manager ? "Issue or work to be done" : "What is wrong?"}><textarea className={`${inputClass} min-h-24`} defaultValue={schedule ? `${schedule.title ?? "Scheduled service"}` : ""} maxLength={2000} name="description" required /></Field>
        {manager ? (
          <>
            <fieldset className="grid gap-2 text-sm">
              <legend className="mb-1 font-semibold">Equipment status while this work is open</legend>
              <label className="flex items-center gap-2"><input defaultChecked name="place" type="radio" value="NONE" /> Leave the status unchanged</label>
              <label className="flex items-center gap-2"><input name="place" type="radio" value="MAINTENANCE" /> Place in <strong>maintenance</strong></label>
              <label className="flex items-center gap-2"><input name="place" type="radio" value="OUT_OF_SERVICE" /> Place <strong>out of service</strong></label>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Starting status"><select className={inputClass} name="status"><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option></select></Field>
              <Field label="Assigned employee"><select className={inputClass} name="performedByEmployeeId"><option value="">Nobody yet</option>{employees.map((e) => <option key={e.id} value={e.id}>{formatName(e)}</option>)}</select></Field>
              <Field label="Or external vendor"><input className={inputClass} maxLength={160} name="vendorName" /></Field>
              <Field label="Meter reading now (if tracked)"><input className={inputClass} inputMode="decimal" name="meterReading" /></Field>
            </div>
            <Field label="Notes"><textarea className={`${inputClass} min-h-16`} maxLength={2000} name="notes" /></Field>
            <p className="text-xs text-[color:var(--muted)]">Photos and documents can be attached on the record once it is created.</p>
          </>
        ) : null}
        <div><SubmitButton>{manager ? "Open record" : "Submit report"}</SubmitButton></div>
      </form>
    </>
  );
}
