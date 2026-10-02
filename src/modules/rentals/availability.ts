import type { Prisma, RentalStatus } from "@/generated/prisma/client";
import { BLOCKING_RENTAL_STATUSES } from "./constants";

export function rangesOverlap(start: Date, end: Date, otherStart: Date, otherEnd: Date) {
  return start < otherEnd && end > otherStart;
}
export function validatesRange(start: Date, end: Date) { return !Number.isNaN(+start) && !Number.isNaN(+end) && start < end; }
export function isOverdue(rental: { reservationEnd: Date; status: RentalStatus }, now = new Date()) {
  return rental.reservationEnd < now && !["RETURNED","CLOSED","CANCELLED"].includes(rental.status);
}
/** One centralized predicate for every scheduled availability query. Endpoints are exclusive. */
export function conflictWhere(organizationId: string, start: Date, end: Date, excludeRentalId?: string): Prisma.RentalItemWhereInput {
  return { equipment: { organizationId, active: true, rentable: true }, rental: {
    organizationId, status: { in: BLOCKING_RENTAL_STATUSES }, reservationStart: { lt: end }, reservationEnd: { gt: start },
    ...(excludeRentalId ? { id: { not: excludeRentalId } } : {}),
  } };
}
export function operationallyAvailable(asset: { active:boolean; rentable:boolean; status:string }) {
  return asset.active && asset.rentable && ["AVAILABLE","RESERVED"].includes(asset.status);
}
