import { AppShell } from "@/components/app-shell";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuthenticatedUser();
  if (user.mustChangePassword) redirect("/account?required=1");
  return <AppShell user={user}>{children}</AppShell>;
}
