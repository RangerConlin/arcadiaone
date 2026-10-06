import type { Prisma } from "@/generated/prisma/client";

export const IMPORT_ENTITIES = ["employees", "departments", "positions", "qualification-types", "employee-qualifications", "clients", "client-contacts", "equipment", "projects"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];
export const isImportEntity = (value: string | undefined | null): value is ImportEntity => IMPORT_ENTITIES.includes(value as ImportEntity);

export type ImportMode = "CREATE" | "UPDATE";
export type FieldDef = { key: string; label: string; required?: boolean; aliases?: string[]; help: string; example: string };

export type RowCheck = {
  action: "create" | "update" | "skip";
  errors: string[];
  warnings: string[];
  /** Short human description of the row for previews and results. */
  label: string;
  /** Normalized, database-ready values; only present when there are no errors. */
  payload?: Record<string, unknown>;
  matchId?: string;
};

export type Tx = Prisma.TransactionClient;
export type WriteContext = { organizationId: string; userId: string };

export type EntityDef<Ctx = unknown> = {
  key: ImportEntity;
  label: string;
  description: string;
  fields: FieldDef[];
  /** Present only when update mode is unambiguous for this entity. */
  updateIdentity?: string;
  guidance: string[];
  load(organizationId: string): Promise<Ctx>;
  check(values: Record<string, string>, ctx: Ctx, mode: ImportMode, line: number): RowCheck;
  write(tx: Tx, check: RowCheck, ctx: Ctx, who: WriteContext): Promise<"created" | "updated">;
};

export type RowOutcome = { line: number; status: "valid" | "warning" | "error"; action: RowCheck["action"]; label: string; errors: string[]; warnings: string[] };
export type PreviewSummary = { total: number; valid: number; warnings: number; rejected: number; toCreate: number; toUpdate: number };
