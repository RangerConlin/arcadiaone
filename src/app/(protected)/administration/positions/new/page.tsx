import { PageHeader } from "@/components/page-header";
import { createPosition } from "@/modules/people/actions";
import { PositionForm } from "@/modules/people/admin-forms";

export default async function NewPositionPage({
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
          { label: "Positions", href: "/administration/positions" },
          { label: "New position" },
        ]}
        title="New Position"
      />
      <PositionForm action={createPosition} error={params.error} />
    </>
  );
}
