import { PageHeader } from "@/components/page-header";
import { Field, inputClass, Notice, SubmitButton } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { saveMaintenanceSettings } from "@/modules/maintenance/actions";
import { saveTrainingSettings } from "@/modules/training/actions";

export const dynamic = "force-dynamic";

function Check({ name, checked, label, hint }: { name: string; checked: boolean; label: string; hint: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input className="mt-1" defaultChecked={checked} name={name} type="checkbox" />
      <span><span className="font-semibold">{label}</span><span className="block text-xs text-[color:var(--muted)]">{hint}</span></span>
    </label>
  );
}

export default async function LifecycleSettingsPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const user = await requireRole("ADMIN");
  const [query, org] = await Promise.all([searchParams, prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } })]);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Administration", href: "/administration" }, { label: "Training and maintenance settings" }]}
        description="Organization policy for training verification and equipment maintenance. Defaults are conservative."
        title="Training and maintenance settings"
      />
      <Notice message={query.success} tone="success" />
      <Notice message={query.error} tone="error" />
      <form action={saveTrainingSettings} className="mb-6 grid max-w-3xl gap-4 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <h2 className="text-base font-semibold">Training</h2>
        <Check checked={org.allowTrainingSelfEnrollment} hint="Employees may enroll themselves in sessions that are marked Open." label="Allow self-enrollment" name="allowTrainingSelfEnrollment" />
        <Check checked={org.managersCanVerifyTraining} hint="Otherwise only administrators verify external records. Nobody can verify their own." label="Managers may verify external training records" name="managersCanVerifyTraining" />
        <Check checked={org.allowVerifiedQualificationFromTraining} hint="Lets a course be configured to create a verified qualification when training is completed. Off: such courses create unverified qualifications that still need verification." label="Allow training to grant verified qualifications" name="allowVerifiedQualificationFromTraining" />
        <Field label="Remind enrolled participants this many days before a session (0 = no reminders)"><input className={`${inputClass} max-w-32`} defaultValue={org.trainingSessionReminderDays} max={30} min={0} name="trainingSessionReminderDays" type="number" /></Field>
        <div><SubmitButton>Save training settings</SubmitButton></div>
      </form>
      <form action={saveMaintenanceSettings} className="grid max-w-3xl gap-4 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <h2 className="text-base font-semibold">Equipment maintenance</h2>
        <Check checked={org.managersCanManageMaintenance} hint="Create, progress, complete and schedule maintenance. Employees can never close records." label="Managers may manage maintenance" name="managersCanManageMaintenance" />
        <Check checked={org.employeesCanReportMaintenance} hint="Lets any employee report a problem; it opens a record without changing the equipment's status." label="Employees may report issues" name="employeesCanReportMaintenance" />
        <Check checked={org.autoPostMaintenanceCostToLedger} hint="Off: an administrator records costs in the ledger deliberately, per record." label="Record maintenance costs in the ledger automatically when work is completed" name="autoPostMaintenanceCostToLedger" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Service is “due soon” within (days)"><input className={inputClass} defaultValue={org.maintenanceDueSoonDays} max={180} min={1} name="maintenanceDueSoonDays" type="number" /></Field>
          <Field label="Meter-based service is “due soon” within (% of the interval)"><input className={inputClass} defaultValue={org.maintenanceMeterWarningPercent} max={50} min={1} name="maintenanceMeterWarningPercent" type="number" /></Field>
        </div>
        <div><SubmitButton>Save maintenance settings</SubmitButton></div>
      </form>
    </>
  );
}
