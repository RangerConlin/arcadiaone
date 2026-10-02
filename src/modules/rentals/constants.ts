import type { EquipmentCondition, EquipmentStatus, RentalStatus } from "@/generated/prisma/enums";

export const EQUIPMENT_STATUSES: EquipmentStatus[] = ["AVAILABLE","RESERVED","PREPARING","CHECKED_OUT","INSPECTION","MAINTENANCE","OUT_OF_SERVICE","LOST"];
export const EQUIPMENT_CONDITIONS: EquipmentCondition[] = ["NEW","EXCELLENT","GOOD","FAIR","POOR","DAMAGED"];
export const RENTAL_STATUSES: RentalStatus[] = ["DRAFT","RESERVED","PREPARING","READY","CHECKED_OUT","PARTIALLY_RETURNED","RETURNED","CLOSED","CANCELLED"];
export const BLOCKING_RENTAL_STATUSES: RentalStatus[] = ["RESERVED","PREPARING","READY","CHECKED_OUT","PARTIALLY_RETURNED","RETURNED"];
export const CONDITION_SEVERITY: Record<EquipmentCondition,number> = { NEW:0, EXCELLENT:1, GOOD:2, FAIR:3, POOR:4, DAMAGED:5 };
