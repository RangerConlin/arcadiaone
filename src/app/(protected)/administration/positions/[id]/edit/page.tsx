import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { updatePosition } from "@/modules/people/actions";
import { getPosition } from "@/modules/people/data";
import { PositionForm } from "@/modules/people/admin-forms";

export const dynamic = "force-dynamic";

export default async function EditPositionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const position = await getPosition(id);

  if (!position) {
    notFound();
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Administration", href: "/administration" },
          { label: "Positions", href: "/administration/positions" },
          { label: "Edit" },
        ]}
        title="Edit Position"
      />
      <PositionForm action={updatePosition} error={query.error} position={position} />
    </>
  );
}
