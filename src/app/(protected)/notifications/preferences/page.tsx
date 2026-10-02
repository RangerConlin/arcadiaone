import { PageHeader } from "@/components/page-header";
import { Notice, SubmitButton } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { saveNotificationPreferences } from "@/modules/notifications/actions";
import { availableChannels } from "@/modules/notifications/channels";
import { CATEGORY_LABELS, NOTIFICATION_CATEGORIES } from "@/modules/notifications/constants";
import { getPreferences } from "@/modules/notifications/service";

export const dynamic = "force-dynamic";

export default async function PreferencesPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const [user, query] = await Promise.all([requireAuthenticatedUser(), searchParams]);
  const enabled = await getPreferences(user);
  const emailAvailable = availableChannels().includes("EMAIL");
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Notifications", href: "/notifications" }, { label: "Preferences" }]}
        description="Choose which in-app notifications you receive. Turning one off does not hide the underlying work from dashboards or the calendar."
        title="Notification preferences"
      />
      <Notice message={query.success} tone="success" />
      <Notice message={query.error} tone="error" />
      <form action={saveNotificationPreferences} className="max-w-3xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--border)] text-left">
              <th className="p-3" scope="col">Category</th>
              <th className="p-3" scope="col">In-app</th>
              <th className="p-3 text-[color:var(--muted)]" scope="col">Email</th>
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_CATEGORIES.map((category) => (
              <tr className="border-b border-[color:var(--border)] last:border-0" key={category}>
                <th className="p-3 text-left font-normal" scope="row">
                  <label htmlFor={`inapp-${category}`}><span className="font-semibold">{CATEGORY_LABELS[category].label}</span><span className="block text-xs text-[color:var(--muted)]">{CATEGORY_LABELS[category].description}</span></label>
                </th>
                <td className="p-3"><input defaultChecked={enabled(category, "IN_APP")} id={`inapp-${category}`} name={`inapp:${category}`} type="checkbox" /></td>
                <td className="p-3"><input aria-label={`${CATEGORY_LABELS[category].label} by email (not available)`} disabled type="checkbox" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between gap-4 p-3">
          <p className="text-xs text-[color:var(--muted)]">{emailAvailable ? "Email delivery is configured." : "Email delivery is not configured for this installation, so no emails are sent."}</p>
          <SubmitButton>Save preferences</SubmitButton>
        </div>
      </form>
    </>
  );
}
