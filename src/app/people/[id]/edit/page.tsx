import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { updateEmployee } from "@/modules/people/actions";
import { getEmployee, getEmployeeFormOptions } from "@/modules/people/data";
import { EmployeeForm } from "@/modules/people/employee-form";

export const dynamic = "force-dynamic";

export default async function EditEmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const [employee, options] = await Promise.all([
    getEmployee(id),
    getEmployeeFormOptions(id),
  ]);

  if (!employee) {
    notFound();
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "People", href: "/people" },
          { label: "Employee", href: `/people/${employee.id}` },
          { label: "Edit" },
        ]}
        description="Update foundational employee information."
        title="Edit Employee"
      />
      <EmployeeForm
        action={updateEmployee}
        cancelHref={`/people/${employee.id}`}
        employee={employee}
        error={query.error}
        options={options}
        submitLabel="Save employee"
      />
    </>
  );
}
