import { z } from "zod";
import { isValidTimeZone } from "@/lib/datetime";
import { PREFIX_PATTERN } from "./numbering";

const text = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const intIn = (label: string, min: number, max: number) =>
  z.coerce.number({ error: `${label} must be a number.` }).int(`${label} must be a whole number.`).min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`);
const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());

export const identitySchema = z.object({
  displayName: z.string().trim().min(1, "Display name is required.").max(160),
  legalName: text(200),
  billingAddress: text(600),
  phone: text(40),
  generalEmail: z.string().trim().max(200).transform((v) => v || null).pipe(z.email("Enter a valid general email address.").nullable()),
  website: z.string().trim().max(200).transform((v) => v || null).refine((v) => v === null || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), "Website must start with http:// or https://."),
  timezone: z.string().trim().refine(isValidTimeZone, "Choose a valid time zone."),
  defaultCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code such as USD."),
});

export const thresholdsSchema = z.object({
  qualificationExpirationWarningDays: intIn("Qualification expiring-soon threshold", 1, 365),
  taskDueSoonDays: intIn("Task due-soon threshold", 1, 60),
  rentalDueSoonDays: intIn("Rental return reminder threshold", 1, 60),
  invoiceDueSoonDays: intIn("Invoice due-soon threshold", 1, 90),
  maintenanceDueSoonDays: intIn("Maintenance due-soon threshold", 1, 180),
});

export const defaultsSchema = z.object({
  qualificationAutoVerifyAdminEntries: checkbox,
  defaultRentalTerms: text(4000),
  defaultPaymentTerms: text(300),
  invoiceDefaultDueDays: z.string().trim().transform((v) => (v === "" ? null : Number(v))).pipe(z.number({ error: "Default due days must be a number." }).int().min(0, "Default due days cannot be negative.").max(365, "Default due days must be at most 365.").nullable()),
  invoiceDefaultTerms: text(4000),
  invoiceFooter: text(1000),
});

export const notificationsSchema = z.object({
  notificationArchiveAfterDays: intIn("Notification retention", 0, 3650),
});

export const featuresSchema = z.object({
  featureRentals: checkbox, featureLedger: checkbox, featureTraining: checkbox, featureMaintenance: checkbox, featureClientPortal: checkbox,
});

export const prefixField = z.string().trim().regex(PREFIX_PATTERN, "Prefixes may contain letters, digits and . _ / - (up to 12 characters).");
export const sequenceField = intIn("Next number", 1, 99_999_999);

export const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Invalid settings.";
