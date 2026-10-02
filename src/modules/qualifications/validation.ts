import { z } from "zod";

const optionalText = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const optionalDate = z.string().trim().transform((v, ctx) => {
  if (!v) return null;
  const date = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) {
    ctx.addIssue({ code: "custom", message: "Enter a valid date." });
    return z.NEVER;
  }
  return date;
});

export const qualificationTypeSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(120),
    abbreviation: optionalText(20),
    description: optionalText(1000),
    category: z.enum(["CERTIFICATION", "LICENSE", "QUALIFICATION", "AUTHORIZATION", "INTERNAL"]),
    issuingOrganization: optionalText(160),
    expirationBehavior: z.enum(["DOES_NOT_EXPIRE", "TRACKED", "CALCULATED"]),
    defaultValidityMonths: z.string().transform((v) => (v ? Number(v) : null)),
    credentialNumberExpected: z.boolean(),
    documentExpected: z.boolean(),
    active: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.defaultValidityMonths !== null && (!Number.isInteger(value.defaultValidityMonths) || value.defaultValidityMonths < 1 || value.defaultValidityMonths > 600))
      ctx.addIssue({ code: "custom", path: ["defaultValidityMonths"], message: "Validity must be 1–600 months." });
    if (value.expirationBehavior === "CALCULATED" && !value.defaultValidityMonths)
      ctx.addIssue({ code: "custom", path: ["defaultValidityMonths"], message: "Calculated expiration requires a validity period." });
  });

export const employeeQualificationSchema = z
  .object({
    employeeId: z.string().uuid(),
    qualificationTypeId: z.string().uuid(),
    credentialNumber: optionalText(120),
    issuingOrganization: optionalText(160),
    issueDate: optionalDate,
    expirationDate: optionalDate,
    notes: optionalText(2000),
  })
  .superRefine((value, ctx) => {
    if (value.issueDate && value.expirationDate && value.expirationDate < value.issueDate)
      ctx.addIssue({ code: "custom", path: ["expirationDate"], message: "Expiration cannot precede issue date." });
  });

export const requirementSchema = z.object({
  positionId: z.string().uuid(),
  qualificationTypeId: z.string().uuid(),
  required: z.boolean(),
  notes: optionalText(500),
});
