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

