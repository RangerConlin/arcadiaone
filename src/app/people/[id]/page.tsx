import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ButtonLink, Notice, SecondaryLink, StatusBadge } from "@/components/ui";
import { formatDate, formatFullName, formatName } from "@/lib/format";
import { getEmployee } from "@/modules/people/data";

export const dynamic = "force-dynamic";

export default async function EmployeeProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const employee = await getEmployee(id);

  if (!employee) {
    notFound();
  }

  return (
    <>
      <PageHeader
        actions={
          <>
            <SecondaryLink href="/people">Back to directory</SecondaryLink>
            <ButtonLink href={`/people/${employee.id}/edit`}>Edit employee</ButtonLink>
          </>
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "People", href: "/people" },
          { label: formatName(employee) },
        ]}
        description="Employee profile and foundational employment details."
        title={formatName(employee)}
      />
      <Notice message={query.success} tone="success" />
      <section className="grid gap-5 xl:grid-cols-[2fr_1fr]">
        <div className="grid gap-5">
          <Panel title="Overview">
            <Description label="Legal name" value={formatFullName(employee)} />
            <Description label="Employee #" value={employee.employeeNumber || "Not set"} />
            <Description label="Status" value={<StatusBadge status={employee.employmentStatus} />} />
            <Description label="Position" value={employee.position?.title || "Not assigned"} />
            <Description label="Department" value={employee.department?.name || "Not assigned"} />
          </Panel>
          <Panel title="Employment">
            <Description label="Supervisor" value={employee.supervisor ? formatName(employee.supervisor) : "None"} />
            <Description label="Hire date" value={formatDate(employee.hireDate)} />
            <Description label="Separation date" value={formatDate(employee.separationDate)} />
            <Description label="Direct reports" value={`${employee.directReports.length}`} />
          </Panel>
          <Panel title="Contact">
            <Description label="Work email" value={employee.workEmail || "Not set"} />
            <Description label="Personal email" value={employee.personalEmail || "Not set"} />
            <Description label="Work phone" value={employee.workPhone || "Not set"} />
            <Description label="Mobile phone" value={employee.mobilePhone || "Not set"} />
          </Panel>
          <Panel title="Notes">
            <p className="whitespace-pre-wrap text-sm leading-6 text-[color:var(--muted)]">
              {employee.notes || "No notes recorded."}
            </p>
          </Panel>
        </div>
        <aside className="rounded-sm border border-dashed border-[color:var(--border)] bg-[color:var(--panel)] p-5">
          <h2 className="text-base font-semibold">Future profile areas</h2>
          <div className="mt-4 grid gap-2 text-sm text-[color:var(--muted)]">
            <span>Certifications</span>
            <span>Training</span>
            <span>Projects</span>
            <span>Documents</span>
          </div>
        </aside>
      </section>
    </>
  );
}

function Panel({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      <dl className="grid gap-3 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Description({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[color:var(--muted)]">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}
