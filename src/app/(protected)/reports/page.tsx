import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { reportsFor } from "@/modules/reports/registry";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await requireAuthenticatedUser();
  const categories = reportsFor(user);
  return (
    <>
      <PageHeader
        description="Filtered and historical views you can review and export. The dashboard shows the current snapshot; reports go deeper. You only see reports your role may run, and each one shows only records you can access."
        title="Reports"
      />
      <div className="grid gap-6">
        {categories.map((category) => (
          <section aria-labelledby={`cat-${category.id}`} key={category.id}>
            <h2 className="mb-2 text-base font-semibold" id={`cat-${category.id}`}>{category.label}</h2>
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {category.reports.map((report) => (
                <li className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4" key={report.id}>
                  <Link className="font-semibold text-[color:var(--accent)] hover:underline" href={`/reports/${report.id}`}>{report.title}</Link>
                  <p className="mt-1 text-sm text-[color:var(--muted)]">{report.description}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
