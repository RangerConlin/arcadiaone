import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { updateDepartment } from "@/modules/people/actions";
import { getDepartment } from "@/modules/people/data";
import { DepartmentForm } from "@/modules/people/admin-forms";

export const dynamic = "force-dynamic";

export default async function EditDepartmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const department = await getDepartment(id);

  if (!department) {
    notFound();
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Administration", href: "/administration" },
          { label: "Departments", href: "/administration/departments" },
          { label: "Edit" },
        ]}
        title="Edit Department"
      />
      <DepartmentForm
        action={updateDepartment}
        department={department}
        error={query.error}
      />
    </>
  );
}
