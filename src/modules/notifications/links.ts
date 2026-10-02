import type { NotificationEntityType } from "@/generated/prisma/enums";

/**
 * Notification links are generated here, on the server, from fixed route templates and
 * record ids. Nothing user-supplied is ever used as a redirect target.
 */
const ID = "[0-9a-fA-F-]{36}";

export const notificationLinks = {
  task: (id: string) => `/tasks/${id}`,
  project: (id: string) => `/projects/${id}`,
  projectTeam: (id: string) => `/projects/${id}?tab=team`,
  qualification: (employeeId: string) => `/people/${employeeId}`,
  rental: (id: string) => `/rentals/${id}`,
  invoice: (id: string) => `/invoices/${id}`,
  signature: (id: string) => `/signatures/${id}`,
  approval: (clientId: string) => `/clients/${clientId}?tab=portal`,
  document: (id: string) => `/documents/${id}`,
  trainingSession: (id: string) => `/training/sessions/${id}`,
  trainingRecord: (id: string) => `/training/records/${id}`,
  maintenance: (id: string) => `/maintenance/${id}`,
  equipment: (id: string) => `/rentals/equipment/${id}`,
} as const;

const ALLOWED: RegExp[] = [
  new RegExp(`^/tasks/${ID}$`),
  new RegExp(`^/projects/${ID}(\\?tab=(team|overview|tasks|milestones))?$`),
  new RegExp(`^/people/${ID}$`),
  new RegExp(`^/rentals/${ID}$`),
  new RegExp(`^/invoices/${ID}$`),
  new RegExp(`^/signatures/${ID}$`),
  new RegExp(`^/clients/${ID}\\?tab=portal$`),
  new RegExp(`^/documents/${ID}$`),
  new RegExp(`^/training/(sessions|records)/${ID}$`),
  new RegExp(`^/maintenance/${ID}$`),
  new RegExp(`^/rentals/equipment/${ID}$`),
];

/** Defense in depth: only same-origin, known application routes are ever redirected to. */
export function safeActionUrl(url: string | null | undefined) {
  if (!url || !url.startsWith("/") || url.startsWith("//")) return null;
  return ALLOWED.some((pattern) => pattern.test(url)) ? url : null;
}

export const ENTITY_LABELS: Record<NotificationEntityType, string> = {
  TASK: "Task", PROJECT: "Project", EMPLOYEE_QUALIFICATION: "Qualification", RENTAL: "Rental",
  INVOICE: "Invoice", SIGNATURE_REQUEST: "Signature request", CLIENT_APPROVAL_REQUEST: "Approval", DOCUMENT: "Document",
  TRAINING_SESSION: "Training session", TRAINING_RECORD: "Training record", MAINTENANCE_RECORD: "Maintenance", EQUIPMENT: "Equipment",
};
