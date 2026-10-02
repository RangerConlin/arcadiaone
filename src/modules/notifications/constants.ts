import type { NotificationCategory, NotificationType } from "@/generated/prisma/enums";

export const NOTIFICATION_CATEGORIES = [
  "TASK_ASSIGNMENTS", "TASK_REMINDERS", "QUALIFICATIONS", "RENTALS", "INVOICES",
  "SIGNATURES", "APPROVALS", "PROJECT_UPDATES", "DOCUMENTS", "TRAINING", "MAINTENANCE",
] as const satisfies readonly NotificationCategory[];

export const CATEGORY_LABELS: Record<NotificationCategory, { label: string; description: string }> = {
  TASK_ASSIGNMENTS: { label: "Task assignments", description: "When a task is assigned to you." },
  TASK_REMINDERS: { label: "Task due reminders", description: "Tasks that are due soon, due tomorrow, or overdue." },
  QUALIFICATIONS: { label: "Qualification expiration", description: "Your credentials that are expiring or have expired." },
  RENTALS: { label: "Rentals", description: "Rentals you are responsible for that are due back or overdue." },
  INVOICES: { label: "Invoices", description: "Invoices you manage that are due soon or overdue." },
  SIGNATURES: { label: "Signatures", description: "Signature requests that need you." },
  APPROVALS: { label: "Approvals", description: "Client approval requests and responses." },
  PROJECT_UPDATES: { label: "Project updates", description: "Being added to a project team." },
  DOCUMENTS: { label: "Documents", description: "Documents shared with you or your projects." },
  TRAINING: { label: "Training", description: "Enrollments, upcoming and changed sessions, and records awaiting verification." },
  MAINTENANCE: { label: "Equipment maintenance", description: "Service due or overdue, equipment taken out of service, and completed work." },
};

/** Single source of truth for which preference category governs each notification type. */
export const TYPE_CATEGORY: Record<NotificationType, NotificationCategory> = {
  TASK_ASSIGNED: "TASK_ASSIGNMENTS",
  TASK_DUE_TOMORROW: "TASK_REMINDERS",
  TASK_DUE_SOON: "TASK_REMINDERS",
  TASK_OVERDUE: "TASK_REMINDERS",
  QUALIFICATION_EXPIRING: "QUALIFICATIONS",
  QUALIFICATION_EXPIRED: "QUALIFICATIONS",
  RENTAL_DUE_SOON: "RENTALS",
  RENTAL_OVERDUE: "RENTALS",
  INVOICE_DUE_SOON: "INVOICES",
  INVOICE_OVERDUE: "INVOICES",
  SIGNATURE_REQUESTED: "SIGNATURES",
  APPROVAL_REQUESTED: "APPROVALS",
  CLIENT_RESPONSE_RECEIVED: "APPROVALS",
  PROJECT_MEMBER_ADDED: "PROJECT_UPDATES",
  DOCUMENT_SHARED: "DOCUMENTS",
  TRAINING_ENROLLED: "TRAINING",
  TRAINING_SESSION_REMINDER: "TRAINING",
  TRAINING_SESSION_CHANGED: "TRAINING",
  TRAINING_VERIFICATION_NEEDED: "TRAINING",
  MAINTENANCE_DUE_SOON: "MAINTENANCE",
  MAINTENANCE_OVERDUE: "MAINTENANCE",
  MAINTENANCE_COMPLETED: "MAINTENANCE",
  EQUIPMENT_UNAVAILABLE: "MAINTENANCE",
};

/**
 * Serious business conditions can be read but not dismissed, so a notification can never be
 * used to bury an overdue item. (Dismissing hides the notification only; it never changes
 * the underlying record either way.)
 */
const NON_DISMISSIBLE: ReadonlySet<NotificationType> = new Set([
  "TASK_OVERDUE", "RENTAL_OVERDUE", "INVOICE_OVERDUE", "QUALIFICATION_EXPIRED", "MAINTENANCE_OVERDUE",
]);
export const isDismissible = (type: NotificationType) => !NON_DISMISSIBLE.has(type);

export const TYPE_LABELS: Record<NotificationType, string> = {
  TASK_ASSIGNED: "Task assigned",
  TASK_DUE_TOMORROW: "Task due tomorrow",
  TASK_DUE_SOON: "Task due soon",
  TASK_OVERDUE: "Task overdue",
  QUALIFICATION_EXPIRING: "Qualification expiring",
  QUALIFICATION_EXPIRED: "Qualification expired",
  RENTAL_DUE_SOON: "Rental due back",
  RENTAL_OVERDUE: "Rental overdue",
  INVOICE_DUE_SOON: "Invoice due soon",
  INVOICE_OVERDUE: "Invoice overdue",
  SIGNATURE_REQUESTED: "Signature requested",
  APPROVAL_REQUESTED: "Approval requested",
  CLIENT_RESPONSE_RECEIVED: "Client response",
  PROJECT_MEMBER_ADDED: "Project team",
  DOCUMENT_SHARED: "Document shared",
  TRAINING_ENROLLED: "Training enrollment",
  TRAINING_SESSION_REMINDER: "Training reminder",
  TRAINING_SESSION_CHANGED: "Training update",
  TRAINING_VERIFICATION_NEEDED: "Verification needed",
  MAINTENANCE_DUE_SOON: "Maintenance due soon",
  MAINTENANCE_OVERDUE: "Maintenance overdue",
  MAINTENANCE_COMPLETED: "Maintenance completed",
  EQUIPMENT_UNAVAILABLE: "Equipment unavailable",
};

/** Overdue/expired items get a stronger visual treatment in lists. */
export const isUrgentType = (type: NotificationType) => NON_DISMISSIBLE.has(type);

export const NOTIFICATION_PAGE_SIZE = 25;
export const NOTIFICATION_MENU_SIZE = 6;
