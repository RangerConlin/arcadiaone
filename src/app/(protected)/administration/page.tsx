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
