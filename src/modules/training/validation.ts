import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { isDayKey, keyToDate } from "@/lib/datetime";

export const DELIVERY_METHODS = ["IN_PERSON", "VIRTUAL", "ONLINE_SELF_PACED", "BLENDED", "OTHER"] as const;
export const DELIVERY_LABELS: Record<(typeof DELIVERY_METHODS)[number], string> = {
  IN_PERSON: "In person", VIRTUAL: "Virtual", ONLINE_SELF_PACED: "Online, self-paced", BLENDED: "Blended", OTHER: "Other",
};
export const QUALIFICATION_EFFECTS = ["NONE", "SUGGEST", "CREATE_UNVERIFIED", "CREATE_VERIFIED"] as const;
export const EFFECT_LABELS: Record<(typeof QUALIFICATION_EFFECTS)[number], string> = {
  NONE: "No qualification effect", SUGGEST: "Suggest a qualification", CREATE_UNVERIFIED: "Create an unverified qualification", CREATE_VERIFIED: "Create a verified qualification (needs organization policy)",
};

/** Exact, bounded decimal (hours, scores): up to `intDigits` integer digits and 2 decimals. */
export function parseDecimal(input: string | null | undefined, intDigits = 4): Prisma.Decimal | null {
  const cleaned = String(input ?? "").trim();
  if (!new RegExp(`^\\d{1,${intDigits}}(\\.\\d{1,2})?$`).test(cleaned)) return null;
  return new Prisma.Decimal(cleaned);
}

const optionalText = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const optionalId = z.string().trim().transform((v) => v || null);
const optionalDecimal = (label: string, intDigits = 4) => z.string().trim().transform((v, ctx) => {
  if (!v) return null;
  const parsed = parseDecimal(v, intDigits);
  if (!parsed) { ctx.addIssue({ code: "custom", message: `${label} must be a number with at most two decimals.` }); return z.NEVER; }
  return parsed;
});
const day = (label: string) => z.string().trim().refine(isDayKey, `Enter a valid ${label}.`);

export const courseSchema = z.object({
  name: z.string().trim().min(1, "Course name is required.").max(160),
  code: optionalText(40),
  description: optionalText(2000),
  provider: optionalText(160),
  defaultDurationHours: optionalDecimal("Default duration", 3),
  deliveryMethod: z.string().trim().transform((v) => (v || null)).pipe(z.enum(DELIVERY_METHODS).nullable()),
});

export const sessionSchema = z.object({
  trainingCourseId: z.string().trim().min(1, "Choose a course."),
  titleOverride: optionalText(160),
  startDate: day("start date"), startTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid start time."),
  endDate: z.string().trim().refine((v) => !v || isDayKey(v), "Enter a valid end date."),
  endTime: z.string().trim().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, "Enter a valid end time."),
  location: optionalText(200), instructor: optionalText(160), providerOverride: optionalText(160),
  maxParticipants: z.string().trim().transform((v, ctx) => {
    if (!v) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 10000) { ctx.addIssue({ code: "custom", message: "Maximum participants must be a whole number of at least 1." }); return z.NEVER; }
    return n;
  }),
  notes: optionalText(4000),
  status: z.enum(["PLANNED", "OPEN"]),
});

export const outcomeSchema = z.object({
  status: z.enum(["ENROLLED", "ATTENDED", "COMPLETED", "NO_SHOW", "CANCELLED"]),
  completionDate: z.string().trim().refine((v) => !v || isDayKey(v), "Enter a valid completion date."),
  hoursCompleted: optionalDecimal("Hours completed"),
  score: optionalDecimal("Score", 4),
  passed: z.string().trim().transform((v) => (v === "true" ? true : v === "false" ? false : null)),
  notes: optionalText(2000),
});

export const recordSchema = z.object({
  employeeId: z.string().trim().min(1),
  trainingCourseId: optionalId,
  courseName: z.string().trim().min(1, "Course name is required.").max(200),
  provider: z.string().trim().min(1, "Provider is required.").max(160),
  completionDate: day("completion date"),
  hours: optionalDecimal("Hours"),
  certificateNumber: optionalText(120),
  notes: optionalText(2000),
});

export const dateKeyToDate = keyToDate;
