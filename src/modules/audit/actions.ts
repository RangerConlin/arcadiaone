/** Consistent `domain.subject.verb` action names. Add new ones here, not inline. */
export const AUDIT_ACTIONS = {
  authLoginSuccess: "auth.login.success",
  authLoginFailure: "auth.login.failure",
  authLogout: "auth.logout",
  authPasswordChanged: "auth.password.changed",
  authPasswordReset: "auth.password.reset",
  userCreated: "user.created",
  userActivated: "user.activated",
  userDeactivated: "user.deactivated",
  userRoleChanged: "user.role.changed",
  employeeCreated: "employee.created",
  employeeUpdated: "employee.updated",
  employeeStatusChanged: "employee.status.changed",
  qualificationAdded: "qualification.added",
  qualificationUpdated: "qualification.updated",
  qualificationVerified: "qualification.verified",
  qualificationRejected: "qualification.rejected",
  qualificationArchived: "qualification.archived",
  projectCreated: "project.created",
  projectUpdated: "project.updated",
  projectStatusChanged: "project.status.changed",
  projectArchived: "project.archived",
  taskCreated: "task.created",
  taskReassigned: "task.reassigned",
  taskCompleted: "task.completed",
  clientCreated: "client.created",
  clientUpdated: "client.updated",
  clientArchived: "client.archived",
  equipmentStatusChanged: "equipment.status.changed",
  equipmentConditionChanged: "equipment.condition.changed",
  rentalCheckedOut: "rental.checked_out",
  rentalReturned: "rental.returned",
  rentalStatusChanged: "rental.status.changed",
  documentUploaded: "document.uploaded",
  documentVersionAdded: "document.version.added",
  documentArchived: "document.archived",
  documentRestored: "document.restored",
  documentAccessChanged: "document.access.changed",
  documentDownloaded: "document.downloaded",
  signatureSent: "signature.sent",
  signatureCompleted: "signature.completed",
  signatureDeclined: "signature.declined",
  signatureCancelled: "signature.cancelled",
  invoiceCreated: "invoice.created",
  invoiceUpdated: "invoice.updated",
  invoiceIssued: "invoice.issued",
  invoiceVoided: "invoice.voided",
  paymentRecorded: "payment.recorded",
  paymentCorrected: "payment.corrected",
  ledgerCreated: "ledger.created",
  ledgerVoided: "ledger.voided",
  portalUserInvited: "portal.user.invited",
  portalUserActivated: "portal.user.activated",
  portalUserAccessChanged: "portal.user.access.changed",
  portalApprovalSubmitted: "portal.approval.submitted",
  portalPasswordChanged: "portal.password.changed",
  trainingCourseCreated: "training.course.created",
  trainingCourseUpdated: "training.course.updated",
  trainingSessionCreated: "training.session.created",
  trainingSessionUpdated: "training.session.updated",
  trainingSessionCompleted: "training.session.completed",
  trainingSessionCancelled: "training.session.cancelled",
  trainingEnrollmentCompleted: "training.enrollment.completed",
  trainingRecordSubmitted: "training.record.submitted",
  trainingRecordVerified: "training.record.verified",
  trainingRecordRejected: "training.record.rejected",
  trainingSettingsChanged: "training.settings.changed",
  maintenanceOpened: "maintenance.opened",
  maintenanceStatusChanged: "maintenance.status.changed",
  maintenanceCompleted: "maintenance.completed",
  maintenanceCancelled: "maintenance.cancelled",
  maintenanceScheduleSaved: "maintenance.schedule.saved",
  equipmentPlacedOutOfService: "equipment.unavailable",
  equipmentReturnedToService: "equipment.returned_to_service",
  maintenanceSettingsChanged: "maintenance.settings.changed",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_ENTITY_TYPES = [
  "User", "Employee", "EmployeeQualification", "Project", "Task", "Client", "Equipment", "Rental", "Document",
  "SignatureRequest", "Invoice", "Payment", "LedgerTransaction", "ClientPortalUser", "ClientApprovalRequest",
  "TrainingCourse", "TrainingSession", "EmployeeTrainingRecord", "MaintenanceRecord", "MaintenanceSchedule", "Organization",
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/** Trusted route for an audited record, when one exists. */
export function auditEntityHref(entityType: string, entityId: string | null | undefined): string | null {
  if (!entityId) return null;
  switch (entityType) {
    case "User": return `/administration/users/${entityId}`;
    case "Employee": return `/people/${entityId}`;
    case "Project": return `/projects/${entityId}`;
    case "Task": return `/tasks/${entityId}`;
    case "Client": return `/clients/${entityId}`;
    case "Equipment": return `/rentals/equipment/${entityId}`;
    case "Rental": return `/rentals/${entityId}`;
    case "Document": return `/documents/${entityId}`;
    case "SignatureRequest": return `/signatures/${entityId}`;
    case "Invoice": return `/invoices/${entityId}`;
    case "LedgerTransaction": return `/ledger/${entityId}`;
    case "TrainingSession": return `/training/sessions/${entityId}`;
    case "EmployeeTrainingRecord": return `/training/records/${entityId}`;
    case "MaintenanceRecord": return `/maintenance/${entityId}`;
    default: return null;
  }
}
