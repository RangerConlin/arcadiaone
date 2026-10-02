import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/page-header";
import { createEmployee } from "@/modules/people/actions";
import { getEmployeeFormOptions } from "@/modules/people/data";
import { EmployeeForm } from "@/modules/people/employee-form";

export const dynamic = "force-dynamic";

export default async function NewEmployeePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  await requireRole("ADMIN");
  const params = (await searchParams) ?? {};
  const options = await getEmployeeFormOptions();

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "People", href: "/people" },
          { label: "New employee" },
        ]}
        description="Create a foundational employee record."
        title="Add Employee"
      />
      <EmployeeForm
        action={createEmployee}
        cancelHref="/people"
        error={params.error}
        options={options}
        submitLabel="Create employee"
      />
    </>
  );
}
