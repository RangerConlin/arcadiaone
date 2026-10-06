import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Field, inputClass, Notice, SubmitButton } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { deleteLogo, saveSettings, uploadLogo } from "@/modules/settings/actions";
import { getNumbering } from "@/modules/settings/service";
import { CATEGORY_LABELS, NOTIFICATION_CATEGORIES } from "@/modules/notifications/constants";

export const dynamic = "force-dynamic";

const TABS = [
  ["identity", "Organization"], ["numbering", "Numbering"], ["thresholds", "Thresholds"], ["defaults", "Defaults"],
  ["notifications", "Notifications"], ["features", "Features"],
] as const;

const FEATURES = [
  ["featureRentals", "Rentals and equipment"], ["featureLedger", "Ledger"], ["featureTraining", "Training"],
  ["featureMaintenance", "Maintenance"], ["featureClientPortal", "Client portal links"],
] as const;

const panel = "grid max-w-3xl gap-5 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5";
const Check = ({ name, checked, children, value }: { name: string; checked: boolean; children: React.ReactNode; value?: string }) => (
  <label className="flex items-start gap-2 text-sm"><input className="mt-1" defaultChecked={checked} name={name} type="checkbox" value={value} /><span>{children}</span></label>
);
const Hint = ({ children }: { children: React.ReactNode }) => <span className="mt-1 block text-xs text-[color:var(--muted)]">{children}</span>;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; success?: string; error?: string }> }) {
  const [admin, query] = await Promise.all([requireRole("ADMIN"), searchParams]);
  const tab = TABS.some(([key]) => key === query.tab) ? query.tab! : "identity";
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: admin.organizationId } });
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const zoneOptions = zones.includes(org.timezone) ? zones : [org.timezone, ...zones];
  const numbering = tab === "numbering" ? await getNumbering(admin.organizationId) : null;
  const off = new Set<string>(org.notificationDefaultOffCategories);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Administration", href: "/administration" }, { label: "Settings" }]}
        description="Organization identity, numbering, thresholds, defaults and feature availability. Changes are recorded in the audit log."
        title="Settings"
      />
      <Notice message={query.success} tone="success" />
      <Notice message={query.error} tone="error" />
      <nav aria-label="Settings sections" className="mb-5 flex flex-wrap gap-2">
        {TABS.map(([key, name]) => (
          <Link aria-current={tab === key ? "page" : undefined} className={`rounded-sm border px-3 py-1.5 text-sm ${tab === key ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-white" : "border-[color:var(--border)]"}`} href={`/administration/settings?tab=${key}`} key={key}>{name}</Link>
        ))}
      </nav>

      {tab === "identity" ? (
        <div className="grid gap-5">
          <form action={saveSettings} className={panel}>
            <input name="section" type="hidden" value="identity" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Display name"><input className={inputClass} defaultValue={org.displayName ?? org.name} name="displayName" required /></Field>
              <Field label="Legal name"><input className={inputClass} defaultValue={org.legalName ?? ""} name="legalName" /></Field>
            </div>
            <Field label="Address"><textarea className={inputClass} defaultValue={org.billingAddress ?? ""} name="billingAddress" rows={3} /></Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Main phone"><input className={inputClass} defaultValue={org.phone ?? ""} name="phone" /></Field>
              <Field label="General email"><input className={inputClass} defaultValue={org.generalEmail ?? ""} name="generalEmail" type="email" /></Field>
              <Field label="Website"><input className={inputClass} defaultValue={org.website ?? ""} name="website" placeholder="https://" /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Time zone">
                <select className={inputClass} defaultValue={org.timezone} name="timezone">{zoneOptions.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select>
                <Hint>Calendar times and “today” for reminders use this zone unless a user picks their own.</Hint>
              </Field>
              <Field label="Default currency"><input className={inputClass} defaultValue={org.defaultCurrency} maxLength={3} name="defaultCurrency" /><Hint>Used for new invoices and ledger entries.</Hint></Field>
            </div>
            <div><SubmitButton>Save organization</SubmitButton></div>
          </form>
          <section className={panel}>
            <h2 className="text-base font-semibold">Logo</h2>
            <p className="text-sm text-[color:var(--muted)]">Shown in the header and available to document headers. PNG, JPEG or WebP, up to 1 MB. Stored with the shared document storage.</p>
            {org.logoStorageKey ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="Current organization logo" className="max-h-20 w-auto self-start rounded-sm border border-[color:var(--border)] bg-white p-2" src={`/branding/logo?v=${org.updatedAt.getTime()}`} />
            ) : <p className="text-sm">No logo uploaded.</p>}
            <form action={uploadLogo} className="flex flex-wrap items-end gap-3">
              <Field label={org.logoStorageKey ? "Replace logo" : "Upload logo"}><input accept="image/png,image/jpeg,image/webp" className={inputClass} name="logo" required type="file" /></Field>
              <SubmitButton>Upload</SubmitButton>
            </form>
            {org.logoStorageKey ? <form action={deleteLogo}><button className="text-sm underline" type="submit">Remove logo</button></form> : null}
          </section>
        </div>
      ) : null}

      {tab === "numbering" && numbering ? (
        <form action={saveSettings} className={panel}>
          <input name="section" type="hidden" value="numbering" />
          <p className="text-sm text-[color:var(--muted)]">Numbers are a prefix plus a zero-padded sequence, handed out atomically so two people can never receive the same number. Invoice and ledger counters can only move forward; skipped numbers are never reused.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr><th className="p-2">Records</th><th className="p-2">Prefix</th><th className="p-2">Next number</th><th className="p-2">Auto-assign when blank</th></tr></thead>
              <tbody>
                {numbering.sequences.map((row) => (
                  <tr className="border-t border-[color:var(--border)]" key={row.entity}>
                    <td className="p-2">{row.label}</td>
                    <td className="p-2"><input aria-label={`${row.label} prefix`} className={inputClass} defaultValue={row.prefix} maxLength={12} name={`${row.entity}.prefix`} /></td>
                    <td className="p-2"><input aria-label={`${row.label} next number`} className={inputClass} defaultValue={row.nextValue} min={1} name={`${row.entity}.nextValue`} type="number" /></td>
                    <td className="p-2">{row.optional ? <input aria-label={`${row.label} auto-assign`} defaultChecked={row.autoAssign} name={`${row.entity}.autoAssign`} type="checkbox" /> : "Always"}</td>
                  </tr>
                ))}
                <tr className="border-t border-[color:var(--border)]">
                  <td className="p-2">Invoices (assigned on issue)</td>
                  <td className="p-2"><input aria-label="Invoice prefix" className={inputClass} defaultValue={numbering.invoicePrefix} maxLength={12} name="invoicePrefix" required /></td>
                  <td className="p-2"><input aria-label="Next invoice number" className={inputClass} defaultValue={numbering.nextInvoiceSequence} min={numbering.nextInvoiceSequence} name="nextInvoiceSequence" type="number" /></td>
                  <td className="p-2">Always</td>
                </tr>
                <tr className="border-t border-[color:var(--border)]">
                  <td className="p-2">Ledger transactions</td>
                  <td className="p-2"><input aria-label="Ledger prefix" className={inputClass} defaultValue={numbering.ledgerPrefix} maxLength={12} name="ledgerPrefix" required /></td>
                  <td className="p-2"><input aria-label="Next ledger number" className={inputClass} defaultValue={numbering.nextLedgerSequence} min={numbering.nextLedgerSequence} name="nextLedgerSequence" type="number" /></td>
                  <td className="p-2">Always</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[color:var(--muted)]">Employee numbers are entered by hand or imported and are not generated. Changing a prefix affects only newly generated numbers.</p>
          <div><SubmitButton>Save numbering</SubmitButton></div>
        </form>
      ) : null}

      {tab === "thresholds" ? (
        <form action={saveSettings} className={panel}>
          <input name="section" type="hidden" value="thresholds" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Qualifications: expiring soon (days)"><input className={inputClass} defaultValue={org.qualificationExpirationWarningDays} max={365} min={1} name="qualificationExpirationWarningDays" required type="number" /></Field>
            <Field label="Tasks: due soon (days)"><input className={inputClass} defaultValue={org.taskDueSoonDays} max={60} min={1} name="taskDueSoonDays" required type="number" /></Field>
            <Field label="Rentals: return reminder (days)"><input className={inputClass} defaultValue={org.rentalDueSoonDays} max={60} min={1} name="rentalDueSoonDays" required type="number" /></Field>
            <Field label="Invoices: due soon (days)"><input className={inputClass} defaultValue={org.invoiceDueSoonDays} max={90} min={1} name="invoiceDueSoonDays" required type="number" /></Field>
            <Field label="Maintenance: due soon (days)"><input className={inputClass} defaultValue={org.maintenanceDueSoonDays} max={180} min={1} name="maintenanceDueSoonDays" required type="number" /></Field>
          </div>
          <p className="text-sm text-[color:var(--muted)]">Used by dashboards, the calendar and the scheduled reminder worker. Training enrollment and maintenance permission policy live under <Link className="underline" href="/administration/lifecycle">Training and maintenance settings</Link>.</p>
          <div><SubmitButton>Save thresholds</SubmitButton></div>
        </form>
      ) : null}

      {tab === "defaults" ? (
        <form action={saveSettings} className={panel}>
          <input name="section" type="hidden" value="defaults" />
          <h2 className="text-base font-semibold">Qualifications</h2>
          <Check checked={org.qualificationAutoVerifyAdminEntries} name="qualificationAutoVerifyAdminEntries">Mark qualifications entered by an administrator as verified automatically. Everyone else’s entries still wait for review.</Check>
          <h2 className="text-base font-semibold">Rentals</h2>
          <Field label="Default rental terms"><textarea className={inputClass} defaultValue={org.defaultRentalTerms ?? ""} name="defaultRentalTerms" rows={4} /><Hint>Pre-filled on new rentals; editable per rental.</Hint></Field>
          <h2 className="text-base font-semibold">Invoices</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default payment terms"><input className={inputClass} defaultValue={org.defaultPaymentTerms ?? ""} name="defaultPaymentTerms" placeholder="Net 30" /></Field>
            <Field label="Default due date (days after issue date)"><input className={inputClass} defaultValue={org.invoiceDefaultDueDays ?? ""} max={365} min={0} name="invoiceDefaultDueDays" type="number" /><Hint>Leave blank for “due on receipt”. Default currency: {org.defaultCurrency} (change under Organization).</Hint></Field>
          </div>
          <Field label="Default invoice terms and conditions"><textarea className={inputClass} defaultValue={org.invoiceDefaultTerms ?? ""} name="invoiceDefaultTerms" rows={3} /></Field>
          <Field label="Invoice footer"><textarea className={inputClass} defaultValue={org.invoiceFooter ?? ""} name="invoiceFooter" rows={2} /></Field>
          <div><SubmitButton>Save defaults</SubmitButton></div>
        </form>
      ) : null}

      {tab === "notifications" ? (
        <form action={saveSettings} className={panel}>
          <input name="section" type="hidden" value="notifications" />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-base font-semibold">In-app categories on by default</legend>
            <p className="text-sm text-[color:var(--muted)]">Applies to people who have not chosen their own preference. Individual choices always win.</p>
            <div className="grid gap-2 sm:grid-cols-2">{NOTIFICATION_CATEGORIES.map((category) => <Check checked={!off.has(category)} key={category} name="enabledCategories" value={category}>{CATEGORY_LABELS[category].label}</Check>)}</div>
          </fieldset>
          <Field label="Archive read or dismissed notifications after (days, 0 = never)"><input className={inputClass} defaultValue={org.notificationArchiveAfterDays} max={3650} min={0} name="notificationArchiveAfterDays" required type="number" /></Field>
          <div><SubmitButton>Save notification defaults</SubmitButton></div>
        </form>
      ) : null}

      {tab === "features" ? (
        <form action={saveSettings} className={panel}>
          <input name="section" type="hidden" value="features" />
          <p className="text-sm text-[color:var(--muted)]">These switches only show or hide navigation and entry points. No data is deleted or hidden from reports, search, exports or direct links.</p>
          {FEATURES.map(([key, name]) => <Check checked={org[key]} key={key} name={key}>{name}</Check>)}
          <div><SubmitButton>Save features</SubmitButton></div>
        </form>
      ) : null}
    </>
  );
}
