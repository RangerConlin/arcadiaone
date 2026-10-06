import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { audit, userActor } from "@/modules/audit/service";
import { notify } from "@/modules/notifications/service";
import { notificationLinks } from "@/modules/notifications/links";
import { ENTITY_DEFS } from "./entities";
import type { EntityDef, ImportEntity, ImportMode, PreviewSummary, RowCheck, RowOutcome } from "./types";
import { clean } from "./values";
import type { Mapping, Staged } from "./mapping";

/** Imports with more valid rows than this run in the background in chunks instead of one transaction. */
export const SMALL_IMPORT_ROWS = 500;
const CHUNK_SIZE = 200;
const STAGED_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REPORTED = 200;


function rowValues(def: EntityDef, staged: Staged, mapping: Mapping, row: string[]) {
  const values: Record<string, string> = {};
  for (const field of def.fields) {
    const header = mapping[field.key];
    const index = header ? staged.headers.indexOf(header) : -1;
    values[field.key] = index >= 0 ? clean(row[index]) : "";
  }
  return values;
}

export type Evaluation = { summary: PreviewSummary; outcomes: RowOutcome[]; checks: RowCheck[]; unmappedColumns: string[] };

/** Parses, maps, validates and classifies every row. Reads reference data; writes nothing. */
export async function evaluate(organizationId: string, entity: ImportEntity, staged: Staged, mapping: Mapping, mode: ImportMode): Promise<Evaluation> {
  const def = ENTITY_DEFS[entity] as EntityDef;
  if (mode === "UPDATE" && !def.updateIdentity) throw new Error("Update mode is not available for this record type.");
  const ctx = await def.load(organizationId);
  const checks: RowCheck[] = [];
  const outcomes: RowOutcome[] = [];
  const summary: PreviewSummary = { total: staged.rows.length, valid: 0, warnings: 0, rejected: 0, toCreate: 0, toUpdate: 0 };
  staged.rows.forEach((row, index) => {
    const line = index + 2; // header is line 1
    const check = def.check(rowValues(def, staged, mapping, row), ctx, mode, line);
    checks.push(check);
    const status: RowOutcome["status"] = check.errors.length ? "error" : check.warnings.length ? "warning" : "valid";
    if (status === "error") summary.rejected++;
    else { summary.valid++; if (status === "warning") summary.warnings++; if (check.action === "create") summary.toCreate++; if (check.action === "update") summary.toUpdate++; }
    outcomes.push({ line, status, action: check.action, label: check.label, errors: check.errors, warnings: check.warnings });
  });
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  return { summary, outcomes, checks, unmappedColumns: staged.headers.filter((header) => !mapped.has(header)) };
}

/** Marks abandoned, never-confirmed imports as cancelled and drops their staged rows. */
export async function expireStaleImports(organizationId?: string) {
  const result = await prisma.importJob.updateMany({
    where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - STAGED_TTL_MS) }, ...(organizationId ? { organizationId } : {}) },
    data: { status: "CANCELLED", stagedRows: Prisma.DbNull },
  });
  return result.count;
}

const clip = (outcomes: RowOutcome[]) => outcomes.filter((o) => o.status === "error").slice(0, MAX_REPORTED).map((o) => ({ line: o.line, label: o.label.slice(0, 120), messages: o.errors.slice(0, 5) }));

/**
 * Runs a confirmed job. The claim (QUEUED/PENDING → RUNNING) is a single conditional update so a
 * web request and the worker can never run the same job twice. Rows are re-validated against the
 * database as it is now. Up to SMALL_IMPORT_ROWS valid rows go in one all-or-nothing transaction;
 * larger imports commit in chunks, and a failing chunk is retried row by row so one bad row cannot
 * sink its neighbours. Staged rows are always cleared afterwards.
 */
export async function runImportJob(jobId: string): Promise<"done" | "skipped"> {
  const claimed = await prisma.importJob.updateMany({ where: { id: jobId, status: { in: ["PENDING", "QUEUED"] }, stagedRows: { not: Prisma.DbNull } }, data: { status: "RUNNING", startedAt: new Date() } });
  if (!claimed.count) return "skipped";
  const job = await prisma.importJob.findUniqueOrThrow({ where: { id: jobId }, include: { uploadedBy: { select: { id: true, email: true } } } });
  const entity = job.entityType as ImportEntity;
  const def = ENTITY_DEFS[entity] as EntityDef;
  const who = { organizationId: job.organizationId, userId: job.uploadedByUserId };
  try {
    const staged = job.stagedRows as unknown as Staged;
    const mapping = (job.mapping ?? {}) as Mapping;
    const mode = job.mode as ImportMode;
    const evaluation = await evaluate(job.organizationId, entity, staged, mapping, mode);
    // Fresh context for writing so per-pass state (such as in-file duplicate tracking) is not shared.
    const ctx = await def.load(job.organizationId);
    const work = evaluation.checks.map((check, index) => ({ check, index })).filter(({ check }) => !check.errors.length && check.action !== "skip");
    let created = 0, updated = 0, writeErrors: Array<{ line: number; label: string; messages: string[] }> = [];
    const apply = async (tx: Prisma.TransactionClient, check: RowCheck) => ((await def.write(tx, check, ctx, who)) === "created" ? created++ : updated++);

    if (work.length <= SMALL_IMPORT_ROWS) {
      await prisma.$transaction(async (tx) => { for (const { check } of work) await apply(tx, check); }, { timeout: 120_000, maxWait: 10_000 });
    } else {
      let processed = 0;
      for (let start = 0; start < work.length; start += CHUNK_SIZE) {
        const chunk = work.slice(start, start + CHUNK_SIZE);
        const before = { created, updated };
        try {
          await prisma.$transaction(async (tx) => { for (const { check } of chunk) await apply(tx, check); }, { timeout: 120_000, maxWait: 10_000 });
        } catch {
          created = before.created; updated = before.updated;
          for (const { check, index } of chunk) {
            try { await prisma.$transaction((tx) => apply(tx, check)); }
            catch (error) { writeErrors.push({ line: index + 2, label: check.label.slice(0, 120), messages: [error instanceof Error ? error.message.split("\n").pop()!.slice(0, 200) : "The row could not be saved."] }); }
          }
        }
        processed += chunk.length;
        await prisma.importJob.update({ where: { id: jobId }, data: { rowsProcessed: processed, rowsCreated: created, rowsUpdated: updated } });
      }
    }
    writeErrors = writeErrors.slice(0, MAX_REPORTED);
    const rejected = evaluation.summary.rejected + work.length - created - updated;
    const status = rejected > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
    const summary = { total: evaluation.summary.total, warnings: evaluation.summary.warnings, rejectedRows: [...clip(evaluation.outcomes), ...writeErrors].slice(0, MAX_REPORTED), unmappedColumns: evaluation.unmappedColumns } as unknown as Prisma.InputJsonValue;
    await prisma.$transaction(async (tx) => {
      await tx.importJob.update({ where: { id: jobId }, data: { status, completedAt: new Date(), rowsProcessed: evaluation.summary.total, rowsCreated: created, rowsUpdated: updated, rowsRejected: rejected, summary, stagedRows: Prisma.DbNull } });
      await audit.record(tx, {
        organizationId: job.organizationId, actor: userActor(job.uploadedBy), action: AUDIT_ACTIONS.importCompleted, entityType: "ImportJob", entityId: jobId,
        summary: `Import of ${def.label.toLowerCase()} finished: ${created} created, ${updated} updated, ${rejected} rejected`,
        metadata: { entity, mode, rows: evaluation.summary.total, created, updated, rejected },
      });
    });
    if (work.length > SMALL_IMPORT_ROWS) {
      await notify({ organizationId: job.organizationId, userId: job.uploadedByUserId, type: "IMPORT_COMPLETED", title: `Import of ${def.label.toLowerCase()} finished`, message: `${created} created, ${updated} updated, ${rejected} rejected.`, actionUrl: notificationLinks.importJob(jobId), dedupeKey: `import:${jobId}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n").pop()!.slice(0, 300) : "The import failed.";
    await prisma.$transaction(async (tx) => {
      await tx.importJob.update({ where: { id: jobId }, data: { status: "FAILED", completedAt: new Date(), errorMessage: message, stagedRows: Prisma.DbNull } });
      await audit.record(tx, { organizationId: job.organizationId, actor: userActor(job.uploadedBy), action: AUDIT_ACTIONS.importFailed, entityType: "ImportJob", entityId: jobId, outcome: "FAILURE", summary: `Import of ${def.label.toLowerCase()} failed`, metadata: { entity, error: message } });
    });
  }
  return "done";
}

/** Worker sweep: start queued jobs the web process did not pick up, and fail jobs interrupted by a restart. */
export async function sweepImportJobs() {
  const queued = await prisma.importJob.findMany({ where: { status: "QUEUED", createdAt: { lt: new Date(Date.now() - 30_000) } }, select: { id: true }, take: 5 });
  for (const job of queued) await runImportJob(job.id);
  const stuck = await prisma.importJob.findMany({ where: { status: "RUNNING", startedAt: { lt: new Date(Date.now() - 30 * 60_000) } }, select: { id: true, rowsProcessed: true } });
  for (const job of stuck) {
    await prisma.importJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { status: "FAILED", completedAt: new Date(), errorMessage: `Interrupted after ${job.rowsProcessed} rows; already imported rows were kept. Re-run the file in create mode to skip them as duplicates.`, stagedRows: Prisma.DbNull } });
  }
  await expireStaleImports();
  return { started: queued.length, interrupted: stuck.length };
}
