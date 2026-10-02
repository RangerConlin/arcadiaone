import Link from "next/link";
import { logout } from "@/lib/auth/actions";
import type { AuthenticatedUser } from "@/lib/auth/session";
import { PanelNav, RailNav, type NavModule } from "@/components/shell-nav";

function buildModules(user: AuthenticatedUser): NavModule[] {
  const home: NavModule = { id: "home", label: "Dashboard", railLabel: "Home", icon: "home", href: "/", prefix: "/", subs: [{ label: "Dashboard", href: "/" }] };
  const qualifications = { label: "Qualifications", href: "/people/qualifications" };
  const rentals: NavModule = {
    id: "rentals", label: "Rentals", icon: "rentals", href: "/rentals", prefix: "/rentals",
    subs: [{ label: "Rentals", href: "/rentals" }, { label: "Equipment", href: "/rentals/equipment" }, ...(user.role === "ADMIN" ? [{ label: "Settings", href: "/rentals/settings" }] : [])],
  };
  const projects: NavModule = { id: "projects", label: "Projects", icon: "projects", href: "/projects", prefix: "/projects", subs: [{ label: "Projects", href: "/projects" }] };
  const clients: NavModule = { id: "clients", label: "Clients", icon: "clients", href: "/clients", prefix: "/clients", subs: [{ label: "Clients", href: "/clients" }] };
  const documents: NavModule = {
    id: "documents", label: "Documents", icon: "documents", href: "/documents", prefix: "/documents",
    subs: [{ label: "Documents", href: "/documents" }, ...(user.role === "ADMIN" || user.role === "MANAGER" ? [{ label: "Upload", href: "/documents/upload" }] : [])],
  };

  const calendar: NavModule = {
    id: "calendar", label: "Calendar", icon: "calendar", href: "/calendar", prefix: "/calendar",
    subs: [{ label: "Calendar", href: "/calendar" }, { label: "My calendar", href: "/calendar/my" }, { label: "New event", href: "/calendar/events/new" }],
  };

  const training: NavModule = {
    id: "training", label: "Training", icon: "training", href: "/training", prefix: "/training",
    subs: [{ label: "Training", href: "/training" }, { label: "Records", href: "/training?tab=records" }, { label: "Submit external", href: "/training/records/new" }, ...(user.role !== "EMPLOYEE" ? [{ label: "Schedule session", href: "/training/sessions/new" }] : [])],
  };
  const maintenance: NavModule = {
    id: "maintenance", label: "Maintenance", icon: "maintenance", href: "/maintenance", prefix: "/maintenance",
    subs: [{ label: "Overview", href: "/maintenance" }, { label: user.role === "EMPLOYEE" ? "Report an issue" : "New record", href: "/maintenance/new" }],
  };
  const reports: NavModule = { id: "reports", label: "Reports", icon: "reports", href: "/reports", prefix: "/reports", subs: [{ label: "All reports", href: "/reports" }] };
  const ledger: NavModule = {
    id: "ledger", label: "Ledger", icon: "invoices", href: "/ledger", prefix: "/ledger",
    subs: [{ label: "Transactions", href: "/ledger" }, { label: "New transaction", href: "/ledger/new" }, ...(user.role === "ADMIN" ? [{ label: "Categories", href: "/ledger/categories" }] : [])],
  };

  if (user.role === "EMPLOYEE") {
    const profile = user.employeeId ? [{ label: "My Profile", href: `/people/${user.employeeId}` }] : [];
    return [
      home,
      { id: "people", label: "People", icon: "people", href: profile[0]?.href ?? qualifications.href, prefix: "/people", subs: [...profile, qualifications] },
      projects,
      clients,
      rentals,
      calendar,
      training,
      maintenance,
      reports,
      documents,
      { id: "signatures", label: "E-Signatures", railLabel: "Sign", icon: "signatures", href: "/signatures", prefix: "/signatures", subs: [{ label: "Requests", href: "/signatures" }] },
    ];
  }

  return [
    home,
    { id: "people", label: "People", icon: "people", href: "/people", prefix: "/people", subs: [{ label: "Directory", href: "/people" }, qualifications] },
    projects,
    clients,
    rentals,
    { id: "tasks", label: "Tasks", icon: "tasks", href: "/tasks", prefix: "/tasks", subs: [{ label: "All tasks", href: "/tasks" }, { label: "New task", href: "/tasks/new" }] },
    calendar,
    training,
    maintenance,
    reports,
    documents,
    { id: "signatures", label: "E-Signatures", railLabel: "Sign", icon: "signatures", href: "/signatures", prefix: "/signatures", subs: [{ label: "Requests", href: "/signatures" }, { label: "Prepare", href: "/signatures/new" }] },
    { id: "invoices", label: "Invoices", icon: "invoices", href: "/invoices", prefix: "/invoices", subs: [{ label: "Invoices", href: "/invoices" }, { label: "New draft", href: "/invoices/new" }] },
    ledger,
    ...(user.role === "ADMIN"
      ? [{
          id: "admin", label: "Administration", railLabel: "Admin", icon: "admin" as const, href: "/administration", prefix: "/administration",
          subs: [
            { label: "Overview", href: "/administration" },
            { label: "Departments", href: "/administration/departments" },
            { label: "Positions", href: "/administration/positions" },
            { label: "Qualifications", href: "/administration/qualifications" },
            { label: "Project roles", href: "/administration/project-roles" },
            { label: "Users", href: "/administration/users" },
            { label: "Documents", href: "/administration/documents" },
            { label: "Calendar & reminders", href: "/administration/reminders" },
            { label: "Training courses", href: "/administration/training-courses" },
            { label: "Training and maintenance", href: "/administration/lifecycle" },
            { label: "Audit log", href: "/administration/audit" },
          ],
        }]
      : []),
  ];
}

export function AppShell({ children, notifications, organizationName, user }: { children: React.ReactNode; notifications?: React.ReactNode; organizationName: string; user: AuthenticatedUser }) {
  const modules = buildModules(user);
  return (
    <div className="app-shell">
      <RailNav modules={modules} />
      <div className="app-col">
        <header className="app-top">
          <div>
            <p className="app-org">{organizationName}</p>
            <p className="app-tagline">Employee and project management</p>
          </div>
          <div className="app-user">
            {notifications}
            <div className="text-right">
              <Link className="app-user-name" href="/account">{user.displayName}</Link>
              <p className="app-user-role">{user.role}</p>
            </div>
            <form action={logout}><button className="app-logout" type="submit">Log out</button></form>
          </div>
        </header>
        <div className="app-body">
          <PanelNav modules={modules} />
          <main className="app-main">{children}</main>
        </div>
      </div>
    </div>
  );
}
