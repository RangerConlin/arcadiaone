import { PageHeader } from "@/components/page-header";

export function PlaceholderPage({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: title }]}
        description={description}
        title={title}
      />
      <div className="rounded-sm border border-dashed border-[color:var(--border)] bg-[color:var(--panel)] p-8">
        <h2 className="text-base font-semibold">Module not implemented yet</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--muted)]">
          This area is reserved for a future focused development pass. The
          current release keeps working functionality centered on People and
          foundational administration.
        </p>
      </div>
    </>
  );
}
