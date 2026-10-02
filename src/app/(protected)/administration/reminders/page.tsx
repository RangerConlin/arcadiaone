import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Field, inputClass, Notice, SubmitButton } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { saveReminderSettings } from "@/modules/notifications/actions";

export const dynamic = "force-dynamic";

export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const [admin, query] = await Promise.all([requireRole("ADMIN"), searchParams]);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: admin.organizationId } });
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const options = zones.includes(org.timezone) ? zones : [org.timezone, ...zones];
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Administration", href: "/administration" }, { label: "Calendar and reminders" }]}
        description="Organization-wide defaults used by the calendar, dashboards and the scheduled reminder worker."
        title="Calendar and reminders"
      />
      <Notice message={query.success} tone="success" />
      <Notice message={query.error} tone="error" />
      <form action={saveReminderSettings} className="grid max-w-3xl gap-5 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <Field label="Organization time zone">
          <select className={inputClass} defaultValue={org.timezone} name="timezone">
            {options.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
          <span className="mt-1 block text-xs text-[color:var(--muted)]">Calendar times render here unless a user picks their own. “Today” for reminders is evaluated in this zone.</span>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Tasks: due-soon window (days)"><input className={inputClass} defaultValue={org.taskDueSoonDays} max={60} min={1} name="taskDueSoonDays" required type="number" /></Field>
          <Field label="Rentals: due-back window (days)"><input className={inputClass} defaultValue={org.rentalDueSoonDays} max={60} min={1} name="rentalDueSoonDays" required type="number" /></Field>
          <Field label="Invoices: due-soon window (days)"><input className={inputClass} defaultValue={org.invoiceDueSoonDays} max={90} min={1} name="invoiceDueSoonDays" required type="number" /></Field>
        </div>
        <Field label="Archive read or dismissed notifications after (days, 0 = never)">
          <input className={inputClass} defaultValue={org.notificationArchiveAfterDays} max={3650} min={0} name="notificationArchiveAfterDays" required type="number" />
        </Field>
        <p className="text-sm text-[color:var(--muted)]">
          The qualification expiration window ({org.qualificationExpirationWarningDays} days) is managed with{" "}
          <Link className="underline" href="/administration/qualifications">qualification settings</Link> and is reused for reminders.
        </p>
        <div><SubmitButton>Save settings</SubmitButton></div>
      </form>
    </>
  );
}
