import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Field, inputClass, Notice, SubmitButton } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ExportList } from "@/modules/import-export/export-list";
import { expireStaleImports } from "@/modules/import-export/engine";
import { ENTITY_DEFS } from "@/modules/import-export/entities";
import { uploadImport } from "@/modules/import-export/actions";
import { IMPORT_ENTITIES } from "@/modules/import-export/types";

export const dynamic = "force-dynamic";

export default async function ImportExportPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const [admin, query] = await Promise.all([requireRole("ADMIN"), searchParams]);
  await expireStaleImports(admin.organizationId);
  const jobs = await prisma.importJob.findMany({ where: { organizationId: admin.organizationId }, orderBy: { createdAt: "desc" }, take: 15, include: { uploadedBy: { select: { email: true } } } });
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Administration", href: "/administration" }, { label: "Import / export" }]} description="Bring existing records in from CSV files, and take data out as CSV." title="Import / export" />
      <Notice message={query.success} tone="success" />
      <Notice message={query.error} tone="error" />

      <section className="mb-6 max-w-3xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <h2 className="text-base font-semibold">Import from CSV</h2>
        <p className="mt-1 text-sm text-[color:var(--muted)]">Nothing is saved when you upload. You will map columns, review a dry run with counts and any problems, and then confirm.</p>
        <form action={uploadImport} className="mt-4 grid gap-4">
          <Field label="What are you importing?">
            <select className={inputClass} name="entity" required>
              {IMPORT_ENTITIES.map((key) => <option key={key} value={key}>{ENTITY_DEFS[key].label}</option>)}
            </select>
          </Field>
          <Field label="CSV file (UTF-8, up to 5 MB / 20,000 rows)"><input accept=".csv,text/csv" className={inputClass} name="file" required type="file" /></Field>
          <div><SubmitButton>Upload and continue</SubmitButton></div>
        </form>
        <h3 className="mt-6 text-sm font-semibold">Templates</h3>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {IMPORT_ENTITIES.map((key) => <li key={key}><a className="underline" href={`/administration/import-export/template/${key}`}>{ENTITY_DEFS[key].label} template</a></li>)}
        </ul>
        <p className="mt-2 text-xs text-[color:var(--muted)]">Each template has the column headings and one fictional example row — delete the example before importing.</p>
      </section>

      <section className="mb-6 max-w-4xl">
        <h2 className="mb-2 text-base font-semibold">Recent imports</h2>
        {jobs.length ? (
          <div className="overflow-x-auto rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)]">
            <table className="w-full text-left text-sm">
              <thead><tr><th className="p-2">When</th><th className="p-2">Type</th><th className="p-2">By</th><th className="p-2">Status</th><th className="p-2">Created</th><th className="p-2">Updated</th><th className="p-2">Rejected</th></tr></thead>
              <tbody>
                {jobs.map((job) => (
                  <tr className="border-t border-[color:var(--border)]" key={job.id}>
                    <td className="p-2"><Link className="underline" href={`/administration/import-export/${job.id}`}>{job.createdAt.toISOString().slice(0, 16).replace("T", " ")}</Link></td>
                    <td className="p-2">{ENTITY_DEFS[job.entityType as keyof typeof ENTITY_DEFS]?.label ?? job.entityType}</td>
                    <td className="p-2">{job.uploadedBy.email}</td>
                    <td className="p-2">{job.status.replaceAll("_", " ").toLowerCase()}</td>
                    <td className="p-2">{job.rowsCreated}</td><td className="p-2">{job.rowsUpdated}</td><td className="p-2">{job.rowsRejected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-[color:var(--muted)]">No imports yet.</p>}
      </section>

      <section className="max-w-3xl">
        <h2 className="mb-2 text-base font-semibold">Export to CSV</h2>
        <ExportList user={admin} />
      </section>
    </>
  );
}
