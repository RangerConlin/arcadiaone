import Link from "next/link";
import { logout } from "@/lib/auth/actions";
import type { AuthenticatedUser } from "@/lib/auth/session";

const commonNavigation = [
  { label: "Dashboard", href: "/" },
  { label: "People", href: "/people" },
  { label: "Projects", href: "/projects" },
  { label: "Calendar", href: "/calendar" },
  { label: "Reports", href: "/reports" },
];

export function AppShell({ children, user }: { children: React.ReactNode; user: AuthenticatedUser }) {
  const navigation = user.role === "EMPLOYEE"
    ? [{ label: "Dashboard", href: "/" }, ...(user.employeeId ? [{ label: "My Profile", href: `/people/${user.employeeId}` }] : []), ...commonNavigation.slice(2, 4)]
    : [...commonNavigation, ...(user.role === "ADMIN" ? [{ label: "Administration", href: "/administration" }] : [])];
  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-black/20 bg-[color:var(--sidebar)] text-[color:var(--sidebar-foreground)] lg:block">
        <div className="border-b border-white/10 px-6 py-5">
          <Link className="block text-xl font-semibold" href="/">
            ArcadiaOne
          </Link>
          <p className="mt-1 text-sm text-[color:var(--sidebar-muted)]">
            Operations platform
          </p>
        </div>
        <nav className="px-3 py-4">
          {navigation.map((item) => (
            <Link
              className="block rounded-sm px-3 py-2 text-sm font-medium text-[color:var(--sidebar-muted)] hover:bg-white/10 hover:text-white focus:bg-white/10 focus:text-white"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-[color:var(--border)] bg-[color:var(--panel)]/95 px-4 py-3 backdrop-blur sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-[color:var(--accent)]">
                Arcadia Command Solutions
              </p>
              <p className="text-xs text-[color:var(--muted)]">
                Employee and project management
              </p>
            </div>
            <nav className="flex gap-2 overflow-x-auto lg:hidden">
              {navigation.map((item) => (
                <Link
                  className="whitespace-nowrap rounded-sm border border-[color:var(--border)] px-3 py-1.5 text-sm font-medium hover:border-[color:var(--accent)]"
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-3 text-sm">
              <div className="text-right"><Link className="font-semibold hover:text-[color:var(--accent)]" href="/account">{user.displayName}</Link><p className="text-xs text-[color:var(--muted)]">{user.role}</p></div>
              <form action={logout}><button className="rounded-sm border border-[color:var(--border)] px-3 py-1.5 font-medium hover:border-[color:var(--accent)]" type="submit">Log out</button></form>
            </div>
          </div>
        </header>
        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
