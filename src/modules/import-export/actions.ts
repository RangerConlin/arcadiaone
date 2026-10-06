"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { CsvError, MAX_IMPORT_BYTES, parseCsv } from "./csv";
import { evaluate, expireStaleImports, runImportJob, SMALL_IMPORT_ROWS } from "./engine";
import { cleanMapping, type Mapping, type Staged } from "./mapping";
import { ENTITY_DEFS } from "./entities";
import { isImportEntity, type ImportMode } from "./types";

const HOME = "/administration/import-export";
const fail = (path: string, message: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);

/** Step 1: parse the CSV and stage its rows. Nothing is imported yet; the original file is not kept. */
export async function uploadImport(form: FormData) {
  const admin = await requireRole("ADMIN");
  const entity = String(form.get("entity") ?? "");
  if (!isImportEntity(entity)) return fail(HOME, "Choose what you are importing.");
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return fail(HOME, "Choose a CSV file to upload.");
  if (file.size > MAX_IMPORT_BYTES) return fail(HOME, `The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`);
  if (!/\.(csv|txt)$/i.test(file.name)) return fail(HOME, "Only .csv files can be imported. Save spreadsheets as CSV (UTF-8) first.");
  let staged: Staged;
  try {
    const parsed = parseCsv(new Uint8Array(await file.arrayBuffer()));
    if (!parsed.rows.length) return fail(HOME, "The file has a header row but no data rows.");
    staged = { headers: parsed.headers, rows: parsed.rows };
  } catch (error) {
    return fail(HOME, error instanceof CsvError ? error.message : "The file could not be read as CSV.");
  }
  await expireStaleImports(admin.organizationId);
  const job = await prisma.importJob.create({
    data: {
      organizationId: admin.organizationId, uploadedByUserId: admin.id, entityType: entity, filename: file.name.slice(0, 200), status: "PENDING",
      stagedRows: staged as unknown as Prisma.InputJsonValue, rowsTotal: staged.rows.length,
    },
  });
  redirect(`${HOME}/${job.id}?step=map`);
}

async function pendingJob(id: string, organizationId: string) {
  const job = await prisma.importJob.findFirst({ where: { id, organizationId } });
  if (!job) return fail(HOME, "Import not found.");
  if (job.status !== "PENDING" || !job.stagedRows) return fail(`${HOME}/${id}`, "This import has already been started or has expired. Upload the file again.");
  return job;
}

/** Step 2: save the column mapping and mode, then show the dry-run preview. */
export async function saveMapping(form: FormData) {
  const admin = await requireRole("ADMIN");
  const id = String(form.get("jobId") ?? "");
  const job = await pendingJob(id, admin.organizationId);
  const entity = job.entityType;
  if (!isImportEntity(entity)) return fail(HOME, "Unknown import type.");
  const staged = job.stagedRows as unknown as Staged;
  const submitted = Object.fromEntries([...form.entries()].filter(([key]) => key.startsWith("map.")).map(([key, value]) => [key.slice(4), value]));
  const { mapping, error } = cleanMapping(entity, staged.headers, submitted);
  if (error) return fail(`${HOME}/${id}?step=map`, error);
  const requested = String(form.get("mode") ?? "CREATE");
  const mode: ImportMode = requested === "UPDATE" && ENTITY_DEFS[entity].updateIdentity ? "UPDATE" : "CREATE";
  await prisma.importJob.update({ where: { id }, data: { mapping: mapping as Prisma.InputJsonValue, mode } });
  redirect(`${HOME}/${id}?step=preview`);
}

/** Step 3: run the import. Small jobs finish before the redirect; larger ones continue in the background. */
export async function confirmImport(form: FormData) {
  const admin = await requireRole("ADMIN");
  const id = String(form.get("jobId") ?? "");
  const job = await pendingJob(id, admin.organizationId);
  const entity = job.entityType;
  if (!isImportEntity(entity) || !job.mapping) return fail(`${HOME}/${id}?step=map`, "Map the columns first.");
  const evaluation = await evaluate(admin.organizationId, entity, job.stagedRows as unknown as Staged, job.mapping as Mapping, job.mode as ImportMode);
  const importable = evaluation.summary.toCreate + evaluation.summary.toUpdate;
  if (!importable) return fail(`${HOME}/${id}?step=preview`, "There are no valid rows to import.");
  if (importable > SMALL_IMPORT_ROWS) {
    await prisma.importJob.update({ where: { id }, data: { status: "QUEUED", rowsTotal: evaluation.summary.total } });
    // Start immediately in this process; the worker sweep picks it up if the process restarts first.
    void runImportJob(id).catch((error) => console.error("[import] background run failed:", error instanceof Error ? error.message : error));
  } else {
    await runImportJob(id);
  }
  revalidatePath(HOME);
  redirect(`${HOME}/${id}`);
}

export async function cancelImport(form: FormData) {
  const admin = await requireRole("ADMIN");
  const id = String(form.get("jobId") ?? "");
  await prisma.importJob.updateMany({ where: { id, organizationId: admin.organizationId, status: "PENDING" }, data: { status: "CANCELLED", stagedRows: Prisma.DbNull } });
  redirect(`${HOME}?success=${encodeURIComponent("Import cancelled; the uploaded rows were discarded.")}`);
}

