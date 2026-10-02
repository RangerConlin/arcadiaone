import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { isDayKey } from "@/lib/datetime";

export const TYPES = ["INSPECTION", "PREVENTIVE", "REPAIR", "DAMAGE", "CALIBRATION", "SOFTWARE_FIRMWARE", "OTHER"] as const;
export const TYPE_LABELS: Record<(typeof TYPES)[number], string> = { INSPECTION: "Inspection", PREVENTIVE: "Preventive", REPAIR: "Repair", DAMAGE: "Damage", CALIBRATION: "Calibration", SOFTWARE_FIRMWARE: "Software / firmware", OTHER: "Other" };
export const STATUSES = ["OPEN", "IN_PROGRESS", "AWAITING_PARTS", "COMPLETED", "CANCELLED"] as const;
export const CONDITIONS = ["NEW", "EXCELLENT", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

/** Exact decimal with `scale` places (cost: 2, meter: 1). */
export function parseNumber(input: string | null | undefined, scale: number, intDigits: number): Prisma.Decimal | null {
  const cleaned = String(input ?? "").trim().replaceAll(",", "");
  if (!new RegExp(`^\\d{1,${intDigits}}(\\.\\d{1,${scale}})?$`).test(cleaned)) return null;
  return new Prisma.Decimal(cleaned);
}
const optionalNumber = (label: string, scale: number, intDigits: number) => z.string().trim().transform((v, ctx) => {
  if (!v) return null;
  const parsed = parseNumber(v, scale, intDigits);
  if (!parsed) { ctx.addIssue({ code: "custom", message: `${label} must be a non-negative number with at most ${scale} decimal${scale === 1 ? "" : "s"}.` }); return z.NEVER; }
  return parsed;
});
const optionalText = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const optionalId = z.string().trim().transform((v) => v || null);
const optionalDay = (label: string) => z.string().trim().refine((v) => !v || isDayKey(v), `Enter a valid ${label}.`);
const optionalInt = (label: string, max: number) => z.string().trim().transform((v, ctx) => {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max) { ctx.addIssue({ code: "custom", message: `${label} must be a whole number from 1 to ${max}.` }); return z.NEVER; }
  return n;
});
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) => z.string().trim().transform((v) => v || null).pipe(z.enum(values).nullable());

export const openSchema = z.object({
  equipmentId: z.string().trim().min(1, "Choose the equipment."),
  type: z.enum(TYPES), description: z.string().trim().min(3, "Describe the issue or work.").max(2000),
  place: z.enum(["NONE", "MAINTENANCE", "OUT_OF_SERVICE"]), status: z.enum(["OPEN", "IN_PROGRESS"]),
  scheduleId: optionalId, performedByEmployeeId: optionalId, vendorName: optionalText(160),
  meterReading: optionalNumber("Meter reading", 1, 11), notes: optionalText(2000),
});

export const completeSchema = z.object({
  workPerformed: z.string().trim().min(3, "Describe the work performed.").max(4000),
  cost: optionalNumber("Cost", 2, 10), meterReading: optionalNumber("Meter reading", 1, 11),
  vendorName: optionalText(160), performedByEmployeeId: optionalId,
  inspectionResult: optionalEnum(["PASS", "FAIL"] as const), conditionFound: optionalEnum(CONDITIONS), finalCondition: optionalEnum(CONDITIONS),
  postStatus: z.enum(["AVAILABLE", "MAINTENANCE", "OUT_OF_SERVICE", "KEEP"], { error: "Choose the equipment's status after this work." }),
  nextServiceDate: optionalDay("next service date"), nextServiceMeter: optionalNumber("Next service meter", 1, 11),
  postCostToLedger: z.boolean(), notes: optionalText(2000),
});

export const scheduleSchema = z.object({
  id: optionalId, equipmentId: z.string().trim().min(1), type: z.enum(TYPES), title: optionalText(120),
  intervalDays: optionalInt("Interval days", 3650), intervalMonths: optionalInt("Interval months", 240), intervalMeter: optionalNumber("Meter interval", 1, 11),
  lastServiceDate: optionalDay("last service date"), lastServiceMeter: optionalNumber("Last service meter", 1, 11),
  nextServiceDate: optionalDay("next service date"), nextServiceMeter: optionalNumber("Next service meter", 1, 11),
  responsibleEmployeeId: optionalId, active: z.boolean(),
});
