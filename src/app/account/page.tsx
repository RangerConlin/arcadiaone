import { PageHeader } from "@/components/page-header";
import { Field, inputClass, Notice, SubmitButton } from "@/components/ui";
import { changePassword } from "@/lib/auth/actions";
import { prisma } from "@/lib/prisma";
import { saveAccountTimeZone } from "@/modules/notifications/actions";
import { requireAuthenticatedUser } from "@/lib/auth/session";
export default async function AccountPage({ searchParams }: { searchParams?: Promise<Record<string,string|undefined>> }) {
 const user = await requireAuthenticatedUser(); const query = (await searchParams) ?? {};
 const [account, organization] = await Promise.all([prisma.user.findUnique({ where: { id: user.id }, select: { timezone: true } }), prisma.organization.findUnique({ where: { id: user.organizationId }, select: { timezone: true } })]);
 const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
 return <><PageHeader breadcrumbs={[{label:"Dashboard",href:"/"},{label:"Account"}]} description={`Signed in as ${user.email}.`} title="Account settings" />
 <Notice message={query.required ? "You must change your temporary password before continuing." : query.success} tone="success"/><Notice message={query.error} tone="error"/>
 <form action={changePassword} className="max-w-xl grid gap-5 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
 <Field label="Current password"><input autoComplete="current-password" className={inputClass} name="currentPassword" required type="password"/></Field>
 <Field label="New password (at least 12 characters)"><input autoComplete="new-password" className={inputClass} minLength={12} name="newPassword" required type="password"/></Field>
 <Field label="Confirm new password"><input autoComplete="new-password" className={inputClass} minLength={12} name="confirmPassword" required type="password"/></Field><div><SubmitButton>Change password</SubmitButton></div></form>
 <form action={saveAccountTimeZone} className="mt-6 max-w-xl grid gap-5 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
 <Field label="Time zone for calendar and notifications"><select className={inputClass} defaultValue={account?.timezone ?? ""} name="timezone"><option value="">Organization default ({organization?.timezone ?? "UTC"})</option>{zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}</select></Field>
 <div><SubmitButton>Save time zone</SubmitButton></div></form></>;
}
