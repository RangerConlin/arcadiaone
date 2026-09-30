import type { EmploymentStatus } from "@/generated/prisma/enums";

export function formatName(employee: {
  firstName: string;
  preferredName?: string | null;
  lastName: string;
  suffix?: string | null;
}) {
  const given = employee.preferredName || employee.firstName;
  return [given, employee.lastName, employee.suffix].filter(Boolean).join(" ");
}

export function formatFullName(employee: {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  suffix?: string | null;
}) {
  return [employee.firstName, employee.middleName, employee.lastName, employee.suffix]
    .filter(Boolean)
    .join(" ");
}

export function formatDate(date?: Date | null) {
  if (!date) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatStatus(status: EmploymentStatus | string) {
  return status.toLowerCase().replace("_", " ");
}
