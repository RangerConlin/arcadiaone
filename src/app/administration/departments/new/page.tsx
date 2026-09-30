import { PageHeader } from "@/components/page-header";
import { createDepartment } from "@/modules/people/actions";
import { DepartmentForm } from "@/modules/people/admin-forms";

export default async function NewDepartmentPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const params = (await searchParams) ?? {};

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Administration", href: "/administration" },
          { label: "Departments", href: "/administration/departments" },
          { label: "New department" },
        ]}
        title="New Department"
      />
      <DepartmentForm action={createDepartment} error={params.error} />
    </>
  );
}
