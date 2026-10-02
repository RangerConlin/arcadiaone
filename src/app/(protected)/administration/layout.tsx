import { requireRole } from "@/lib/auth/session";
export default async function AdministrationLayout({ children }: { children: React.ReactNode }) {
  await requireRole("ADMIN");
  return children;
}
