import type { Prisma } from "@/generated/prisma/client";

/** Rentals that still need this asset: reserved through checked out, ending now or later. */
const ACTIVE_RENTAL_STATUSES = ["RESERVED", "PREPARING", "READY", "CHECKED_OUT", "PARTIALLY_RETURNED"] as const;

export async function findRentalConflicts(db: Pick<Prisma.TransactionClient, "rental">, organizationId: string, equipmentId: string, now = new Date()) {
  return db.rental.findMany({
    where: { organizationId, status: { in: [...ACTIVE_RENTAL_STATUSES] }, reservationEnd: { gte: now }, items: { some: { equipmentId, returnedAt: null } } },
    select: { id: true, rentalNumber: true, status: true, reservationStart: true, reservationEnd: true, createdByUserId: true, preparedByEmployeeId: true, checkedOutByEmployeeId: true, client: { select: { name: true } }, project: { select: { name: true } } },
    orderBy: { reservationStart: "asc" },
    take: 50,
  });
}
export type RentalConflict = Awaited<ReturnType<typeof findRentalConflicts>>[number];
