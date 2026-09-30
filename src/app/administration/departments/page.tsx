import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ButtonLink, Notice } from "@/components/ui";
import { toggleDepartment } from "@/modules/people/actions";
import { listDepartments } from "@/modules/people/data";

export const dynamic = "force-dynamic";

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const departments = await listDepartments(true);

  return (
    <>
      <PageHeader
        actions={<ButtonLink href="/administration/departments/new">New department</ButtonLink>}
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Administration", href: "/administration" },
          { label: "Departments" },
        ]}
        description="Maintain departments without destructive deletion."
        title="Departments"
      />
      <Notice message={params.success} tone="success" />
      <div className="overflow-hidden rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)]">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="border-b border-[color:var(--border)] text-xs uppercase text-[color:var(--muted)]">
            <tr>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Employees</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((department) => (
              <tr className="border-b border-[color:var(--border)] last:border-0" key={department.id}>
                <td className="px-4 py-3">
                  <p className="font-semibold">{department.name}</p>
                  <p className="text-sm text-[color:var(--muted)]">
                    {department.description || "No description"}
                  </p>
                </td>
                <td className="px-4 py-3">{department.active ? "Active" : "Inactive"}</td>
                <td className="px-4 py-3">{department._count.employees}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Link className="text-[color:var(--accent)] hover:underline" href={`/administration/departments/${department.id}/edit`}>
                      Edit
                    </Link>
                    <form action={toggleDepartment}>
                      <input name="id" type="hidden" value={department.id} />
                      <input name="active" type="hidden" value={department.active ? "false" : "true"} />
                      <button className="text-[color:var(--accent)] hover:underline" type="submit">
                        {department.active ? "Deactivate" : "Activate"}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {departments.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-[color:var(--muted)]">
            No departments have been created yet.
          </div>
        ) : null}
      </div>
    </>
  );
}
