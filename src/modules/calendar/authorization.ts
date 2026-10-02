import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedUser } from "@/lib/auth/session";
import { projectVisibilityWhere } from "@/modules/projects/authorization";

type Actor = Pick<AuthenticatedUser, "id" | "organizationId" | "employeeId" | "role">;

/**
 * Native events: PRIVATE is visible to the creator and assignee only (not even admins),
 * PROJECT follows the linked project's visibility, ORGANIZATION is visible to every
 * internal user. Creators and assignees always see their own events.
 */
export function calendarEventVisibilityWhere(user: Actor): Prisma.CalendarEventWhereInput {
  const own: Prisma.CalendarEventWhereInput[] = [
    { createdByUserId: user.id },
    ...(user.employeeId ? [{ assignedEmployeeId: user.employeeId }] : []),
  ];
  const projectAccess: Prisma.CalendarEventWhereInput =
    user.role === "ADMIN"
      ? { visibility: "PROJECT" }
      : { visibility: "PROJECT", project: projectVisibilityWhere(user as AuthenticatedUser) };
  return {
    organizationId: user.organizationId,
    OR: [...own, { visibility: "ORGANIZATION" }, projectAccess],
  };
}

export type EventPolicySubject = {
  createdByUserId: string;
  visibility: "PRIVATE" | "PROJECT" | "ORGANIZATION";
  project?: { projectManagerId: string | null } | null;
};

/** Edit/cancel: creator, administrators, or the manager of the linked project. */
export function canManageCalendarEvent(user: Actor, event: EventPolicySubject) {
  if (user.role === "ADMIN") return event.visibility !== "PRIVATE" || event.createdByUserId === user.id;
  if (event.createdByUserId === user.id) return true;
  return user.role === "MANAGER" && Boolean(user.employeeId) && event.project?.projectManagerId === user.employeeId && event.visibility !== "PRIVATE";
}

/** Organization-wide events and assigning other people are manager/admin capabilities. */
export function canPublishOrganizationEvents(user: Actor) {
  return user.role === "ADMIN" || user.role === "MANAGER";
}
export function canAssignOthers(user: Actor) {
  return user.role === "ADMIN" || user.role === "MANAGER";
}

/** Mirrors the signature list: staff see all requests; employees only those tied to them or their projects. */
export function signatureVisibilityWhere(user: Actor): Prisma.SignatureRequestWhereInput {
  if (user.role !== "EMPLOYEE") return { organizationId: user.organizationId };
  const employeeId = user.employeeId ?? "__none__";
  return {
    organizationId: user.organizationId,
    document: { relations: { some: { OR: [{ employeeId }, { project: { members: { some: { employeeId, leftAt: null } } } }] } } },
  };
}
