import { prisma } from "@/lib/prisma";
import { documentVisibilityWhere } from "@/modules/documents/authorization";
import { notificationLinks } from "./links";
import { notify, notifySafely, RecipientCache, userIdsForEmployees } from "./service";

/**
 * Immediate notifications, called by module actions right after a successful business
 * change. Every helper loads the record itself (organization-scoped), picks recipients
 * who are entitled to the record, never notifies the person who performed the action,
 * and swallows its own failures so it can never roll back or break the action.
 */

const MAX_DOCUMENT_RECIPIENTS = 25;
const dateLabel = (date: Date) => date.toISOString().slice(0, 10);

export function notifyTaskAssigned(args: { organizationId: string; taskId: string; actorUserId: string }) {
  return notifySafely(async () => {
    const task = await prisma.task.findFirst({
      where: { id: args.taskId, organizationId: args.organizationId },
      select: { id: true, title: true, dueDate: true, assignedToEmployeeId: true, project: { select: { name: true } } },
    });
    if (!task?.assignedToEmployeeId) return;
    const recipient = (await userIdsForEmployees(args.organizationId, [task.assignedToEmployeeId])).get(task.assignedToEmployeeId);
    if (!recipient || recipient === args.actorUserId) return;
    await notify({
      organizationId: args.organizationId, userId: recipient, type: "TASK_ASSIGNED",
      title: "Task assigned to you",
      message: `${task.title}${task.project ? ` (${task.project.name})` : ""}${task.dueDate ? ` — due ${dateLabel(task.dueDate)}` : ""}`,
      entity: { type: "TASK", id: task.id }, actionUrl: notificationLinks.task(task.id),
    });
  });
}

export function notifyProjectMemberAdded(args: { organizationId: string; projectId: string; employeeId: string; actorUserId: string }) {
  return notifySafely(async () => {
    const project = await prisma.project.findFirst({ where: { id: args.projectId, organizationId: args.organizationId }, select: { id: true, name: true } });
    if (!project) return;
    const recipient = (await userIdsForEmployees(args.organizationId, [args.employeeId])).get(args.employeeId);
    if (!recipient || recipient === args.actorUserId) return;
    await notify({
      organizationId: args.organizationId, userId: recipient, type: "PROJECT_MEMBER_ADDED",
      title: "Added to a project", message: `You were added to the ${project.name} team.`,
      entity: { type: "PROJECT", id: project.id }, actionUrl: notificationLinks.project(project.id),
    });
  });
}

/** Internal (employee) signers only; client signers act through the portal's Action Required area. */
export function notifySignatureRequested(args: { organizationId: string; signatureRequestId: string; actorUserId: string }) {
  return notifySafely(async () => {
    const request = await prisma.signatureRequest.findFirst({
      where: { id: args.signatureRequestId, organizationId: args.organizationId },
      select: { id: true, title: true, expiresAt: true, signers: { select: { employeeId: true } } },
    });
    if (!request) return;
    const users = await userIdsForEmployees(args.organizationId, request.signers.map((signer) => signer.employeeId));
    const cache = new RecipientCache(args.organizationId);
    for (const userId of new Set(users.values())) {
      if (userId === args.actorUserId) continue;
      await notify({
        organizationId: args.organizationId, userId, type: "SIGNATURE_REQUESTED",
        title: "Signature requested",
        message: `${request.title}${request.expiresAt ? ` — sign by ${dateLabel(request.expiresAt)}` : ""}`,
        entity: { type: "SIGNATURE_REQUEST", id: request.id }, actionUrl: notificationLinks.signature(request.id),
        dedupeKey: `signature-requested:${request.id}`,
      }, cache);
    }
  });
}

/** A client approval was published: tell the responsible project manager (if someone else created it). */
export function notifyApprovalRequested(args: { organizationId: string; approvalId: string; actorUserId: string }) {
  return notifySafely(async () => {
    const approval = await prisma.clientApprovalRequest.findFirst({
      where: { id: args.approvalId, organizationId: args.organizationId },
      select: { id: true, title: true, clientId: true, client: { select: { name: true } }, project: { select: { projectManagerId: true } } },
    });
    const managerId = approval?.project?.projectManagerId;
    if (!approval || !managerId) return;
    const recipient = (await userIdsForEmployees(args.organizationId, [managerId])).get(managerId);
    if (!recipient || recipient === args.actorUserId) return;
    await notify({
      organizationId: args.organizationId, userId: recipient, type: "APPROVAL_REQUESTED",
      title: "Client approval requested", message: `${approval.title} was sent to ${approval.client.name}.`,
      entity: { type: "CLIENT_APPROVAL_REQUEST", id: approval.id }, actionUrl: notificationLinks.approval(approval.clientId),
      dedupeKey: `approval-requested:${approval.id}`,
    });
  });
}

/** A portal user answered an approval: tell whoever requested it and the project manager. */
export function notifyClientResponseReceived(args: { organizationId: string; approvalId: string }) {
  return notifySafely(async () => {
    const approval = await prisma.clientApprovalRequest.findFirst({
      where: { id: args.approvalId, organizationId: args.organizationId },
      select: {
        id: true, title: true, status: true, clientId: true, requestedByUserId: true,
        client: { select: { name: true } }, project: { select: { projectManagerId: true } },
      },
    });
    if (!approval || approval.status === "PENDING") return;
    const manager = approval.project?.projectManagerId;
    const managerUser = manager ? (await userIdsForEmployees(args.organizationId, [manager])).get(manager) : undefined;
    const cache = new RecipientCache(args.organizationId);
    for (const userId of new Set([approval.requestedByUserId, managerUser].filter((id): id is string => Boolean(id)))) {
      await notify({
        organizationId: args.organizationId, userId, type: "CLIENT_RESPONSE_RECEIVED",
        title: `Client ${approval.status === "APPROVED" ? "approved" : "declined"} a request`,
        message: `${approval.client.name} ${approval.status === "APPROVED" ? "approved" : "declined"} “${approval.title}”.`,
        entity: { type: "CLIENT_APPROVAL_REQUEST", id: approval.id }, actionUrl: notificationLinks.approval(approval.clientId),
        dedupeKey: `approval-response:${approval.id}`,
      }, cache);
    }
  });
}

/**
 * A document was attached to an employee, project or task. Candidate recipients are filtered
 * through the document visibility policy, so nobody is told about a file they cannot open.
 */
export function notifyDocumentShared(args: { organizationId: string; documentId: string; actorUserId: string }) {
  return notifySafely(async () => {
    const document = await prisma.document.findFirst({
      where: { id: args.documentId, organizationId: args.organizationId },
      select: {
        id: true, title: true,
        relations: {
          select: {
            employeeId: true,
            task: { select: { assignedToEmployeeId: true } },
            project: { select: { projectManagerId: true, members: { where: { leftAt: null }, select: { employeeId: true } } } },
          },
        },
      },
    });
    if (!document) return;
    const employeeIds = new Set<string>();
    for (const relation of document.relations) {
      if (relation.employeeId) employeeIds.add(relation.employeeId);
      if (relation.task?.assignedToEmployeeId) employeeIds.add(relation.task.assignedToEmployeeId);
      if (relation.project?.projectManagerId) employeeIds.add(relation.project.projectManagerId);
      relation.project?.members.forEach((member) => employeeIds.add(member.employeeId));
    }
    const candidates = await prisma.user.findMany({
      where: { organizationId: args.organizationId, active: true, id: { not: args.actorUserId }, employeeId: { in: [...employeeIds] } },
      select: { id: true, organizationId: true, employeeId: true, role: true },
      take: MAX_DOCUMENT_RECIPIENTS,
    });
    const cache = new RecipientCache(args.organizationId);
    for (const candidate of candidates) {
      const canOpen = await prisma.document.findFirst({
        where: { id: document.id, ...documentVisibilityWhere({ ...candidate, email: "", displayName: "" }) }, select: { id: true },
      });
      if (!canOpen) continue;
      await notify({
        organizationId: args.organizationId, userId: candidate.id, type: "DOCUMENT_SHARED",
        title: "Document shared with you", message: document.title,
        entity: { type: "DOCUMENT", id: document.id }, actionUrl: notificationLinks.document(document.id),
        dedupeKey: `document-shared:${document.id}`,
      }, cache);
    }
  });
}


// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

const sessionTitle = (session: { titleOverride: string | null; trainingCourse: { name: string } }) => session.titleOverride ?? session.trainingCourse.name;
const dateTimeLabel = (date: Date) => `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)} UTC`;

export function notifyTrainingEnrolled(args: { organizationId: string; sessionId: string; employeeId: string; actorUserId: string }) {
  return notifySafely(async () => {
    const session = await prisma.trainingSession.findFirst({ where: { id: args.sessionId, organizationId: args.organizationId }, include: { trainingCourse: { select: { name: true } } } });
    if (!session) return;
    const recipient = (await userIdsForEmployees(args.organizationId, [args.employeeId])).get(args.employeeId);
    if (!recipient || recipient === args.actorUserId) return;
    await notify({
      organizationId: args.organizationId, userId: recipient, type: "TRAINING_ENROLLED", title: "Enrolled in training",
      message: `${sessionTitle(session)} — ${dateTimeLabel(session.startAt)}${session.location ? `, ${session.location}` : ""}`,
      entity: { type: "TRAINING_SESSION", id: session.id }, actionUrl: notificationLinks.trainingSession(session.id),
      dedupeKey: `training-enrolled:${session.id}:${args.employeeId}:${session.startAt.toISOString()}`,
    });
  });
}

/** Tells enrolled participants that a session moved or was cancelled. The change itself is part of the key. */
export function notifyTrainingSessionChanged(args: { organizationId: string; sessionId: string; change: "rescheduled" | "cancelled"; actorUserId: string }) {
  return notifySafely(async () => {
    const session = await prisma.trainingSession.findFirst({
      where: { id: args.sessionId, organizationId: args.organizationId },
      include: { trainingCourse: { select: { name: true } }, enrollments: { where: { status: { in: ["ENROLLED", "CANCELLED"] } }, select: { employeeId: true, status: true } } },
    });
    if (!session) return;
    const employees = session.enrollments.filter((e) => args.change === "cancelled" || e.status === "ENROLLED").map((e) => e.employeeId);
    const users = await userIdsForEmployees(args.organizationId, employees);
    const cache = new RecipientCache(args.organizationId);
    const stamp = args.change === "cancelled" ? "cancelled" : session.startAt.toISOString();
    for (const userId of new Set(users.values())) {
      if (userId === args.actorUserId) continue;
      await notify({
        organizationId: args.organizationId, userId, type: "TRAINING_SESSION_CHANGED",
        title: args.change === "cancelled" ? "Training cancelled" : "Training rescheduled",
        message: args.change === "cancelled" ? `${sessionTitle(session)} on ${dateTimeLabel(session.startAt)} was cancelled.` : `${sessionTitle(session)} now starts ${dateTimeLabel(session.startAt)}${session.location ? `, ${session.location}` : ""}.`,
        entity: { type: "TRAINING_SESSION", id: session.id }, actionUrl: notificationLinks.trainingSession(session.id), dedupeKey: `training-changed:${session.id}:${stamp}`,
      }, cache);
    }
  });
}

/** An external record needs a verifier: administrators, plus managers only where the organization lets them verify. */
export function notifyTrainingVerificationNeeded(args: { organizationId: string; recordId: string; actorUserId: string }) {
  return notifySafely(async () => {
    const record = await prisma.employeeTrainingRecord.findFirst({ where: { id: args.recordId, organizationId: args.organizationId }, include: { employee: { select: { firstName: true, lastName: true } } } });
    const org = await prisma.organization.findUnique({ where: { id: args.organizationId }, select: { managersCanVerifyTraining: true } });
    if (!record || !org || record.verified) return;
    const verifiers = await prisma.user.findMany({
      where: { organizationId: args.organizationId, active: true, id: { not: args.actorUserId }, employeeId: { not: record.employeeId }, role: { in: org.managersCanVerifyTraining ? ["ADMIN", "MANAGER"] : ["ADMIN"] } },
      select: { id: true }, take: 20,
    });
    const cache = new RecipientCache(args.organizationId);
    for (const verifier of verifiers) {
      await notify({
        organizationId: args.organizationId, userId: verifier.id, type: "TRAINING_VERIFICATION_NEEDED", title: "Training record needs verification",
        message: `${record.employee.firstName} ${record.employee.lastName}: ${record.courseName} (${record.provider})`,
        entity: { type: "TRAINING_RECORD", id: record.id }, actionUrl: notificationLinks.trainingRecord(record.id), dedupeKey: `training-verify:${record.id}`,
      }, cache);
    }
  });
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

/**
 * Equipment became unavailable. Recipients are targeted: whoever owns an upcoming rental that needs
 * the asset, plus administrators only when the change was *not* part of a maintenance record
 * (an unexpected out-of-service). One notification per recipient per asset, status and day.
 */
export function notifyEquipmentUnavailable(args: { organizationId: string; equipmentId: string; status: string; actorUserId: string; maintenanceRecordId?: string | null; unexpected?: boolean }) {
  return notifySafely(async () => {
    const equipment = await prisma.equipment.findFirst({ where: { id: args.equipmentId, organizationId: args.organizationId }, select: { id: true, assetNumber: true, name: true } });
    if (!equipment) return;
    const rentals = await prisma.rental.findMany({
      where: { organizationId: args.organizationId, status: { in: ["RESERVED", "PREPARING", "READY", "CHECKED_OUT", "PARTIALLY_RETURNED"] }, reservationEnd: { gte: new Date() }, items: { some: { equipmentId: equipment.id, returnedAt: null } } },
      select: { id: true, rentalNumber: true, reservationStart: true, createdByUserId: true, preparedByEmployeeId: true, checkedOutByEmployeeId: true }, take: 25,
    });
    const employeeUsers = await userIdsForEmployees(args.organizationId, rentals.flatMap((r) => [r.preparedByEmployeeId, r.checkedOutByEmployeeId]));
    const admins = args.unexpected ? await prisma.user.findMany({ where: { organizationId: args.organizationId, active: true, role: "ADMIN" }, select: { id: true }, take: 10 }) : [];
    const day = new Date().toISOString().slice(0, 10);
    const label = args.status.toLowerCase().replaceAll("_", " ");
    const cache = new RecipientCache(args.organizationId);
    const impacted = new Map<string, string[]>();
    for (const rental of rentals) {
      for (const userId of new Set([rental.createdByUserId, employeeUsers.get(rental.preparedByEmployeeId ?? ""), employeeUsers.get(rental.checkedOutByEmployeeId ?? "")].filter((id): id is string => Boolean(id)))) {
        impacted.set(userId, [...(impacted.get(userId) ?? []), rental.rentalNumber]);
      }
    }
    for (const userId of new Set([...impacted.keys(), ...admins.map((a) => a.id)])) {
      if (userId === args.actorUserId) continue;
      const numbers = impacted.get(userId);
      await notify({
        organizationId: args.organizationId, userId, type: "EQUIPMENT_UNAVAILABLE", title: `${equipment.assetNumber} is now ${label}`,
        message: numbers?.length ? `${equipment.name} is needed by rental${numbers.length === 1 ? "" : "s"} ${numbers.join(", ")}. Review the reservation; no substitute is assigned automatically.` : `${equipment.name} was set to ${label}.`,
        entity: args.maintenanceRecordId ? { type: "MAINTENANCE_RECORD", id: args.maintenanceRecordId } : { type: "EQUIPMENT", id: equipment.id },
        actionUrl: args.maintenanceRecordId ? notificationLinks.maintenance(args.maintenanceRecordId) : notificationLinks.equipment(equipment.id),
        dedupeKey: `equipment-unavailable:${equipment.id}:${args.status}:${day}`,
      }, cache);
    }
  });
}

export function notifyMaintenanceCompleted(args: { organizationId: string; recordId: string; actorUserId: string }) {
  return notifySafely(async () => {
    const record = await prisma.maintenanceRecord.findFirst({ where: { id: args.recordId, organizationId: args.organizationId }, include: { equipment: { select: { assetNumber: true, name: true, status: true } } } });
    if (!record) return;
    const performer = record.performedByEmployeeId ? (await userIdsForEmployees(args.organizationId, [record.performedByEmployeeId])).get(record.performedByEmployeeId) : undefined;
    const cache = new RecipientCache(args.organizationId);
    for (const userId of new Set([record.createdByUserId, performer].filter((id): id is string => Boolean(id)))) {
      if (userId === args.actorUserId) continue;
      await notify({
        organizationId: args.organizationId, userId, type: "MAINTENANCE_COMPLETED", title: "Maintenance completed",
        message: `${record.equipment.assetNumber} ${record.equipment.name}: ${record.description}. Equipment is now ${record.equipment.status.toLowerCase().replaceAll("_", " ")}.`,
        entity: { type: "MAINTENANCE_RECORD", id: record.id }, actionUrl: notificationLinks.maintenance(record.id), dedupeKey: `maintenance-completed:${record.id}`,
      }, cache);
    }
  });
}
