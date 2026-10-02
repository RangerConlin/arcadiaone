import { AppShell } from "@/components/app-shell";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { NotificationBell } from "@/modules/notifications/notification-bell";
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuthenticatedUser();
  if (user.mustChangePassword) redirect("/account?required=1");
  const [organization, zone] = await Promise.all([
    prisma.organization.findUnique({ where: { id: user.organizationId }, select: { name: true } }),
    getViewerTimeZone(user),
  ]);
  return <AppShell notifications={<NotificationBell viewer={user} zone={zone} />} organizationName={organization?.name ?? ""} user={user}>{children}</AppShell>;
}
