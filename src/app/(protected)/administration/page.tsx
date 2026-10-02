import { PageHeader } from "@/components/page-header";
import { SecondaryLink } from "@/components/ui";

export default function AdministrationPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Administration" }]}
        description="Foundational administrative setup for ArcadiaOne."
        title="Administration"
      />
      <section className="grid gap-4 md:grid-cols-2">
        <AdminCard
          description="Create, edit, activate, and deactivate organizational departments."
          href="/administration/departments"
          title="Departments"
        />
        <AdminCard
          description="Define reusable training courses and, optionally, how completing them relates to qualifications."
          href="/administration/training-courses"
          title="Training courses"
        />
        <AdminCard
          description="Training verification and enrollment policy, maintenance permissions and due-soon thresholds."
          href="/administration/lifecycle"
          title="Training and maintenance settings"
        />
        <AdminCard
          description="Review who changed what, and when, across security and business-critical records."
          href="/administration/audit"
          title="Audit log"
        />
        <AdminCard
          description="Set the organization time zone, due-soon windows for tasks, rentals and invoices, and notification archiving."
          href="/administration/reminders"
          title="Calendar and reminders"
        />
        <AdminCard
          description="Define qualification types, expiration rules, and organization warning settings."
          href="/administration/qualifications"
          title="Qualifications"
        />
        <AdminCard
          description="Create, edit, activate, and deactivate job positions."
          href="/administration/positions"
          title="Positions"
        />
        <AdminCard
          description="Create accounts, assign roles, deactivate access, and reset passwords."
          href="/administration/users"
          title="Users"
        />
        <AdminCard
          description="Create reusable project assignment roles independently from employee positions."
          href="/administration/project-roles"
          title="Project roles"
        />
        <AdminCard
          description="Configure shared document categories and storage metadata."
          href="/administration/documents"
          title="Documents"
        />
      </section>
    </>
  );
}

function AdminCard({
  description,
  href,
  title,
}: {
  description: string;
  href: string;
  title: string;
}) {
  return (
    <div className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">{description}</p>
      <div className="mt-4">
        <SecondaryLink href={href}>Manage {title.toLowerCase()}</SecondaryLink>
      </div>
    </div>
  );
}
