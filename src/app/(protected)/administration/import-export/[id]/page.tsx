import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Notice, SubmitButton, inputClass } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { cancelImport, confirmImport, saveMapping } from "@/modules/import-export/actions";
import { evaluate, expireStaleImports, SMALL_IMPORT_ROWS } from "@/modules/import-export/engine";
import { suggestMapping, type Mapping, type Staged } from "@/modules/import-export/mapping";
import { ENTITY_DEFS } from "@/modules/import-export/entities";
import { isImportEntity, type ImportMode } from "@/modules/import-export/types";

export const dynamic = "force-dynamic";
const box = "rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5";

export default async function ImportJobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string; success?: string; error?: string }> }) {
  const [admin, { id }, query] = await Promise.all([requireRole("ADMIN"), params, searchParams]);
  await expireStaleImports(admin.organizationId);
  const job = await prisma.importJob.findFirst({ where: { id, organizationId: admin.organizationId }, include: { uploadedBy: { select: { email: true } } } });
  if (!job || !isImportEntity(job.entityType)) notFound();
  const def = ENTITY_DEFS[job.entityType];
  const header = (
    <PageHeader breadcrumbs={[{ label: "Administration", href: "/administration" }, { label: "Import / export", href: "/administration/import-export" }, { label: def.label }]} description={`${job.filename} · uploaded by ${job.uploadedBy.email}`} title={`Import ${def.label.toLowerCase()}`} />
  );

  if (job.status === "PENDING" && job.stagedRows) {
    const staged = job.stagedRows as unknown as Staged;
    const savedMapping = job.mapping as Mapping | null;
    const step = query.step === "map" || !savedMapping ? "map" : "preview";
    if (step === "map") {
      const mapping = savedMapping ?? suggestMapping(job.entityType, staged.headers);
      return (
        <>
          {header}
          <Notice message={query.error} tone="error" />
          <form action={saveMapping} className={`${box} grid gap-4`}>
            <input name="jobId" type="hidden" value={job.id} />
            <p className="text-sm text-[color:var(--muted)]">{staged.rows.length.toLocaleString()} data rows found. Columns were matched by name; check each one. Unmapped file columns are ignored (and listed in the results).</p>
            <ul className="list-disc pl-5 text-sm text-[color:var(--muted)]">{def.guidance.map((line) => <li key={line}>{line}</li>)}</ul>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead><tr><th className="p-2">Field</th><th className="p-2">Column in your file</th><th className="p-2">Notes</th></tr></thead>
                <tbody>
                  {def.fields.map((field) => (
                    <tr className="border-t border-[color:var(--border)]" key={field.key}>
                      <td className="p-2 font-semibold">{field.label}{field.required ? " *" : ""}</td>
                      <td className="p-2">
                        <select aria-label={`Column for ${field.label}`} className={inputClass} defaultValue={mapping[field.key] ?? ""} name={`map.${field.key}`}>
                          <option value="">— not imported —</option>
                          {staged.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </td>
                      <td className="p-2 text-xs text-[color:var(--muted)]">{field.help}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <fieldset className="grid gap-2 text-sm">
              <legend className="font-semibold">Mode</legend>
              <label className="flex items-start gap-2"><input defaultChecked={job.mode !== "UPDATE"} name="mode" type="radio" value="CREATE" /><span>Create new only (default). Rows that match an existing record are rejected as duplicates.</span></label>
              {def.updateIdentity ? <label className="flex items-start gap-2"><input defaultChecked={job.mode === "UPDATE"} name="mode" type="radio" value="UPDATE" /><span>Create new and update existing. Existing records are matched only by: {def.updateIdentity} Blank cells leave existing values unchanged.</span></label> : <p className="text-xs text-[color:var(--muted)]">Update mode is not offered for this record type (no unambiguous identifier).</p>}
            </fieldset>
            <div className="flex gap-3"><SubmitButton>Preview (dry run)</SubmitButton></div>
          </form>
          <form action={cancelImport} className="mt-3"><input name="jobId" type="hidden" value={job.id} /><button className="text-sm underline" type="submit">Cancel and discard the upload</button></form>
        </>
      );
    }
    const evaluation = await evaluate(admin.organizationId, job.entityType, staged, savedMapping!, job.mode as ImportMode);
    const { summary } = evaluation;
    const problems = evaluation.outcomes.filter((o) => o.status !== "valid");
    const samples = evaluation.outcomes.filter((o) => o.status === "valid").slice(0, 8);
    const importable = summary.toCreate + summary.toUpdate;
    return (
      <>
        {header}
        <Notice message={query.error} tone="error" />
        <section className={`${box} mb-5`}>
          <h2 className="text-base font-semibold">Dry run — nothing has been imported</h2>
          <p className="mt-1 text-sm text-[color:var(--muted)]">Mode: {job.mode === "UPDATE" ? "create new and update existing" : "create new only"}. Counts below show what confirming would do.</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-6">
            {([["Rows", summary.total], ["Valid", summary.valid], ["With warnings", summary.warnings], ["Rejected", summary.rejected], ["To create", summary.toCreate], ["To update", summary.toUpdate]] as const).map(([label, value]) => (
              <div key={label}><dt className="text-xs text-[color:var(--muted)]">{label}</dt><dd className="text-xl font-semibold">{value.toLocaleString()}</dd></div>
            ))}
          </dl>
          {evaluation.unmappedColumns.length ? <p className="mt-3 text-sm">Ignored file columns: {evaluation.unmappedColumns.join(", ")}.</p> : null}
          {importable > SMALL_IMPORT_ROWS ? <p className="mt-3 text-sm">This is a large import: it runs in the background in chunks and you will be notified when it finishes.</p> : null}
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {importable ? (
              <form action={confirmImport}><input name="jobId" type="hidden" value={job.id} /><SubmitButton>{`Confirm and import ${importable.toLocaleString()} ${importable === 1 ? "row" : "rows"}`}</SubmitButton></form>
            ) : <p className="text-sm font-semibold">There are no valid rows to import.</p>}
            <Link className="text-sm underline" href={`/administration/import-export/${job.id}?step=map`}>Change mapping or mode</Link>
            <form action={cancelImport}><input name="jobId" type="hidden" value={job.id} /><button className="text-sm underline" type="submit">Cancel</button></form>
          </div>
          {summary.rejected ? <p className="mt-3 text-sm">Rejected rows are skipped; the rest still import. Fix the file and re-upload to include them.</p> : null}
        </section>
        {problems.length ? (
          <section className={`${box} mb-5`}>
            <h2 className="mb-2 text-base font-semibold">Errors and warnings{problems.length > 100 ? ` (first 100 of ${problems.length})` : ""}</h2>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm">
              <thead><tr><th className="p-2">Line</th><th className="p-2">Record</th><th className="p-2">Result</th><th className="p-2">Details</th></tr></thead>
              <tbody>{problems.slice(0, 100).map((row) => (
                <tr className="border-t border-[color:var(--border)] align-top" key={row.line}>
                  <td className="p-2">{row.line}</td><td className="p-2">{row.label}</td>
                  <td className="p-2 font-semibold">{row.status === "error" ? "Rejected" : "Warning"}</td>
                  <td className="p-2"><ul>{[...row.errors, ...row.warnings].map((m) => <li key={m}>{m}</li>)}</ul></td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
        ) : null}
        {samples.length ? (
          <section className={box}>
            <h2 className="mb-2 text-base font-semibold">Sample of valid rows</h2>
            <ul className="text-sm">{samples.map((row) => <li key={row.line}>Line {row.line}: {row.label} — {row.action}</li>)}</ul>
          </section>
        ) : null}
      </>
    );
  }

  const refresh = job.status === "QUEUED" || job.status === "RUNNING";
  const rejected = ((job.summary as { rejectedRows?: Array<{ line: number; label: string; messages: string[] }> } | null)?.rejectedRows ?? []);
  return (
    <>
      {header}
      {refresh ? <meta content="4" httpEquiv="refresh" /> : null}
      <Notice message={query.success} tone="success" />
      <section className={box}>
        <h2 className="text-base font-semibold">{job.status === "COMPLETED" ? "Import complete" : job.status === "COMPLETED_WITH_ERRORS" ? "Import complete with rejected rows" : job.status === "FAILED" ? "Import failed" : job.status === "CANCELLED" ? "Import cancelled" : "Import in progress"}</h2>
        {refresh ? <p className="mt-1 text-sm">{job.rowsProcessed.toLocaleString()} of {job.rowsTotal.toLocaleString()} rows processed. This page refreshes automatically; you will also get a notification.</p> : null}
        {job.errorMessage ? <p className="mt-2 text-sm text-red-700">{job.errorMessage}</p> : null}
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([["Created", job.rowsCreated], ["Updated", job.rowsUpdated], ["Rejected", job.rowsRejected], ["Rows in file", job.rowsTotal]] as const).map(([label, value]) => (
            <div key={label}><dt className="text-xs text-[color:var(--muted)]">{label}</dt><dd className="text-xl font-semibold">{value.toLocaleString()}</dd></div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-[color:var(--muted)]">The uploaded rows are discarded once an import finishes; only these counts and the rejected-row list are kept.</p>
      </section>
      {rejected.length ? (
        <section className={`${box} mt-5`}>
          <h2 className="mb-2 text-base font-semibold">Rejected rows{job.rowsRejected > rejected.length ? ` (first ${rejected.length} of ${job.rowsRejected})` : ""}</h2>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead><tr><th className="p-2">Line</th><th className="p-2">Record</th><th className="p-2">Reason</th></tr></thead>
            <tbody>{rejected.map((row) => <tr className="border-t border-[color:var(--border)] align-top" key={`${row.line}-${row.label}`}><td className="p-2">{row.line}</td><td className="p-2">{row.label}</td><td className="p-2">{row.messages.join(" ")}</td></tr>)}</tbody>
          </table></div>
        </section>
      ) : null}
      <p className="mt-4"><Link className="text-sm underline" href="/administration/import-export">Back to import / export</Link></p>
    </>
  );
}
