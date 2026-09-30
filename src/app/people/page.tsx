import Link from "next/link";
import { EmploymentStatus } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/page-header";
import { ButtonLink, inputClass, Notice, StatusBadge } from "@/components/ui";
import { formatName } from "@/lib/format";
import { listDepartments, listEmployees } from "@/modules/people/data";

export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const departments = await listDepartments(false);
  const employees = await listEmployees({
    departmentId: params.department || undefined,
    search: params.search || undefined,
    status: Object.values(EmploymentStatus).includes(params.status as EmploymentStatus)
      ? (params.status as EmploymentStatus)
      : undefined,
  });

  return (
    <>
      <PageHeader
        actions={<ButtonLink href="/people/new">Add employee</ButtonLink>}
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "People" }]}
        description="Search and maintain employee records for Arcadia Command Solutions."
        title="People"
      />
      <Notice message={params.success} tone="success" />
      <Notice message={params.error} tone="error" />
      <form className="mb-5 grid gap-3 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4 md:grid-cols-[1fr_220px_180px_auto]">
        <input
          className={inputClass}
          defaultValue={params.search ?? ""}
          name="search"
          placeholder="Search employees"
        />
        <select className={inputClass} defaultValue={params.department ?? ""} name="department">
          <option value="">All departments</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
        <select className={inputClass} defaultValue={params.status ?? ""} name="status">
          <option value="">All statuses</option>
          {Object.values(EmploymentStatus).map((status) => (
            <option key={status} value={status}>
              {status.toLowerCase()}
            </option>
          ))}
        </select>
        <button
          className="rounded-sm bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white"
          type="submit"
        >
          Filter
        </button>
      </form>
      <div className="overflow-hidden rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead className="border-b border-[color:var(--border)] text-xs uppercase text-[color:var(--muted)]">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Employee #</th>
                <th className="px-4 py-3">Position</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Supervisor</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Contact</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr
                  className="border-b border-[color:var(--border)] last:border-0 hover:bg-[color:var(--accent-soft)]/40"
                  key={employee.id}
                >
                  <td className="px-4 py-3">
                    <Link className="font-semibold hover:text-[color:var(--accent)]" href={`/people/${employee.id}`}>
                      {formatName(employee)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[color:var(--muted)]">
                    {employee.employeeNumber || "Not set"}
                  </td>
                  <td className="px-4 py-3">{employee.position?.title || "Not assigned"}</td>
                  <td className="px-4 py-3">{employee.department?.name || "Not assigned"}</td>
                  <td className="px-4 py-3">
                    {employee.supervisor ? formatName(employee.supervisor) : "None"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={employee.employmentStatus} />
                  </td>
                  <td className="px-4 py-3 text-[color:var(--muted)]">
                    {employee.workEmail || employee.mobilePhone || employee.workPhone || "Not set"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {employees.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <h2 className="text-base font-semibold">No employees found</h2>
            <p className="mt-2 text-sm text-[color:var(--muted)]">
              Add an employee or adjust the current search and filters.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
