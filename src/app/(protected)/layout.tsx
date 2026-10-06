import { AppShell } from "@/components/app-shell";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { GlobalSearchBox } from "@/modules/search/search-box";
import { getShellSettings } from "@/modules/settings/service";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { NotificationBell } from "@/modules/notifications/notification-bell";
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuthenticatedUser();
  if (user.mustChangePassword) redirect("/account?required=1");
  const [shell, zone] = await Promise.all([getShellSettings(user.organizationId), getViewerTimeZone(user)]);
  return (
    <AppShell features={shell.features} hasLogo={shell.hasLogo} notifications={<NotificationBell viewer={user} zone={zone} />} organizationName={shell.name} search={<GlobalSearchBox />} user={user}>
      {children}
    </AppShell>
  );
}
