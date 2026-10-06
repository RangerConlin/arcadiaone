import type { Prisma } from "@/generated/prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Human-readable numbers for records whose number is generated here. Invoices and ledger
 * transactions keep their sequence on the Organization row (see invoices/actions.ts and
 * ledger/service.ts); both are also exposed on the numbering settings tab.
 */
export const NUMBER_ENTITIES = {
  PROJECT: { label: "Projects", prefix: "P-", pad: 4, autoAssign: false, optional: true },
  CLIENT: { label: "Clients", prefix: "C-", pad: 4, autoAssign: false, optional: true },
  RENTAL: { label: "Rentals", prefix: "R-", pad: 4, autoAssign: true, optional: false },
  EQUIPMENT: { label: "Equipment (asset numbers)", prefix: "EQ-", pad: 4, autoAssign: false, optional: true },
} as const;
export type NumberEntity = keyof typeof NUMBER_ENTITIES;

export const PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,11}$|^$/;

export const formatNumber = (prefix: string, value: number, pad: number) => `${prefix}${String(value).padStart(pad, "0")}`;

/**
 * Atomically allocates the next number: a single INSERT … ON CONFLICT DO UPDATE … RETURNING, so
 * concurrent requests (even across processes) always receive different values. `isTaken` lets the
 * caller skip numbers that were typed in by hand and would violate the unique index; skipped values
 * are never reused. Call inside the same transaction that creates the record.
 */
export async function allocateNumber(tx: Tx, organizationId: string, entity: NumberEntity, isTaken: (candidate: string) => Promise<boolean>) {
  const config = NUMBER_ENTITIES[entity];
  for (let attempt = 0; attempt < 100; attempt++) {
    const rows = await tx.$queryRaw<Array<{ prefix: string; seq: number }>>`
      INSERT INTO "NumberSequence" (id, "organizationId", entity, prefix, "nextValue", "autoAssign", "updatedAt")
      VALUES (gen_random_uuid()::text, ${organizationId}, ${entity}, ${config.prefix}, 2, ${config.autoAssign}, now())
      ON CONFLICT ("organizationId", entity)
      DO UPDATE SET "nextValue" = "NumberSequence"."nextValue" + 1, "updatedAt" = now()
      RETURNING prefix, "nextValue" - 1 AS seq`;
    const candidate = formatNumber(rows[0]!.prefix, rows[0]!.seq, config.pad);
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error("Could not allocate a free number; check the numbering settings.");
}

/** Whether blank numbers should be generated for this entity (rentals always are). */
export async function shouldAutoAssign(tx: Tx, organizationId: string, entity: NumberEntity) {
  if (!NUMBER_ENTITIES[entity].optional) return true;
  const row = await tx.numberSequence.findUnique({ where: { organizationId_entity: { organizationId, entity } }, select: { autoAssign: true } });
  return row?.autoAssign ?? NUMBER_ENTITIES[entity].autoAssign;
}
