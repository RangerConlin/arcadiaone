import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ButtonLink, Notice } from "@/components/ui";
import { togglePosition } from "@/modules/people/actions";
import { listPositions } from "@/modules/people/data";

export const dynamic = "force-dynamic";

export default async function PositionsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const positions = await listPositions(true);

  return (
    <>
      <PageHeader
        actions={<ButtonLink href="/administration/positions/new">New position</ButtonLink>}
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Administration", href: "/administration" },
          { label: "Positions" },
        ]}
        description="Maintain job positions without destructive deletion."
        title="Positions"
      />
      <Notice message={params.success} tone="success" />
      <div className="overflow-hidden rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)]">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="border-b border-[color:var(--border)] text-xs uppercase text-[color:var(--muted)]">
            <tr>
              <th className="px-4 py-3">Position</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Employees</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => (
              <tr className="border-b border-[color:var(--border)] last:border-0" key={position.id}>
                <td className="px-4 py-3">
                  <p className="font-semibold">{position.title}</p>
                  <p className="text-sm text-[color:var(--muted)]">
                    {position.description || "No description"}
                  </p>
                </td>
                <td className="px-4 py-3">{position.active ? "Active" : "Inactive"}</td>
                <td className="px-4 py-3">{position._count.employees}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Link className="text-[color:var(--accent)] hover:underline" href={`/administration/positions/${position.id}/edit`}>
                      Edit
                    </Link>
                    <form action={togglePosition}>
                      <input name="id" type="hidden" value={position.id} />
                      <input name="active" type="hidden" value={position.active ? "false" : "true"} />
                      <button className="text-[color:var(--accent)] hover:underline" type="submit">
                        {position.active ? "Deactivate" : "Activate"}
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {positions.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-[color:var(--muted)]">
            No positions have been created yet.
          </div>
        ) : null}
      </div>
    </>
  );
}
