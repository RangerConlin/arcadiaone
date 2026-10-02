import { AppShell } from "@/components/app-shell";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuthenticatedUser();
  if (user.mustChangePassword) redirect("/account?required=1");
  const organization = await prisma.organization.findUnique({ where: { id: user.organizationId }, select: { name: true } });
  return <AppShell organizationName={organization?.name ?? ""} user={user}>{children}</AppShell>;
}
