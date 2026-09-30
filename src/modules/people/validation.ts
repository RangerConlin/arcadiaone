import { z } from "zod";
import { EmploymentStatus } from "@/generated/prisma/enums";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length ? value : null));

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .transform((value) => (value.length ? value : null))
  .pipe(z.email().nullable());

const optionalDate = z
  .string()
  .trim()
  .transform((value) => (value.length ? new Date(`${value}T00:00:00`) : null))
  .refine((value) => value === null || !Number.isNaN(value.getTime()), {
    message: "Enter a valid date.",
  });

const optionalId = z
  .string()
  .trim()
  .transform((value) => (value.length ? value : null));

export const employeeSchema = z.object({
  employeeNumber: optionalText(50),
  firstName: z.string().trim().min(1, "First name is required.").max(100),
  preferredName: optionalText(100),
  middleName: optionalText(100),
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
  suffix: optionalText(30),
  workEmail: optionalEmail,
  personalEmail: optionalEmail,
  workPhone: optionalText(40),
  mobilePhone: optionalText(40),
  departmentId: optionalId,
  positionId: optionalId,
  supervisorId: optionalId,
  employmentStatus: z.enum(EmploymentStatus),
  hireDate: optionalDate,
  separationDate: optionalDate,
  notes: optionalText(4000),
});

export const departmentSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  description: optionalText(1000),
  active: z.boolean(),
});

export const positionSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(120),
  description: optionalText(1000),
  active: z.boolean(),
});

export type EmployeeInput = z.infer<typeof employeeSchema>;
export type DepartmentInput = z.infer<typeof departmentSchema>;
export type PositionInput = z.infer<typeof positionSchema>;

export function getString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function getBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

export function flattenError(error: z.ZodError) {
  return error.issues.map((issue) => issue.message).join(" ");
}
