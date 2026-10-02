import { z } from "zod";
import { isDayKey, keyToDate, zonedWallTimeToUtc } from "@/lib/datetime";

const optionalId = z.string().trim().transform((value) => value || null);
const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null);
const day = z.string().trim().refine(isDayKey, "Enter a valid date.");
const time = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time.").or(z.literal(""));

export const eventSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(160),
  description: optionalText(4000),
  location: optionalText(200),
  allDay: z.boolean(),
  startDate: day,
  startTime: time,
  endDate: z.string().trim().refine((value) => !value || isDayKey(value), "Enter a valid end date."),
  endTime: time,
  visibility: z.enum(["PRIVATE", "PROJECT", "ORGANIZATION"]),
  assignedEmployeeId: optionalId,
  projectId: optionalId,
  clientId: optionalId,
});

export function eventInput(data: FormData) {
  const value = (key: string) => String(data.get(key) ?? "");
  return {
    title: value("title"), description: value("description"), location: value("location"),
    allDay: data.get("allDay") === "on",
    startDate: value("startDate"), startTime: value("startTime"), endDate: value("endDate"), endTime: value("endTime"),
    visibility: value("visibility") || "ORGANIZATION",
    assignedEmployeeId: value("assignedEmployeeId"), projectId: value("projectId"), clientId: value("clientId"),
  };
}

/**
 * Converts form fields to stored timestamps. All-day events keep UTC-midnight dates
 * (no zone shifting); timed events are interpreted in the viewer's zone and stored as UTC.
 */
export function resolveEventTimes(input: z.infer<typeof eventSchema>, zone: string): { startAt: Date; endAt: Date | null } {
  if (input.allDay) {
    const endDate = input.endDate || input.startDate;
    if (endDate < input.startDate) throw new Error("End date must be on or after the start date.");
    return { startAt: keyToDate(input.startDate), endAt: endDate === input.startDate ? null : keyToDate(endDate) };
  }
  if (!input.startTime) throw new Error("Start time is required for timed events.");
  const startAt = zonedWallTimeToUtc(input.startDate, input.startTime, zone);
  if (!input.endDate && !input.endTime) return { startAt, endAt: null };
  const endAt = zonedWallTimeToUtc(input.endDate || input.startDate, input.endTime || input.startTime, zone);
  if (endAt < startAt) throw new Error("End must not be before the start.");
  return { startAt, endAt };
}
