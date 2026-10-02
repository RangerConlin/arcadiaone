"use server";

import { redirect } from "next/navigation";
import { requireAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { clientVisibilityWhere } from "@/modules/clients/authorization";
import { projectVisibilityWhere } from "@/modules/projects/authorization";
import { canAssignOthers, canManageCalendarEvent, canPublishOrganizationEvents, calendarEventVisibilityWhere } from "./authorization";
import { getViewerTimeZone } from "./service";
import { eventInput, eventSchema, resolveEventTimes } from "./validation";

const fail = (path: string, message: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);

/** Validates every link and capability server-side; nothing in the form is trusted. */
async function prepare(user: AuthenticatedUser, data: FormData, failPath: string) {
  const parsed = eventSchema.safeParse(eventInput(data));
  if (!parsed.success) return fail(failPath, parsed.error.issues[0]?.message ?? "Invalid event.");
  const input = parsed.data;
  let times;
  try {
    times = resolveEventTimes(input, await getViewerTimeZone(user));
  } catch (error) {
    return fail(failPath, error instanceof Error ? error.message : "Invalid dates.");
  }
  if (input.visibility === "ORGANIZATION" && !canPublishOrganizationEvents(user)) fail(failPath, "Only managers and administrators can create organization-wide events.");
  if (input.visibility === "PROJECT" && !input.projectId) fail(failPath, "Choose a project for a project-visible event.");

  const [project, client, employee] = await Promise.all([
    input.projectId ? prisma.project.findFirst({ where: { id: input.projectId, ...projectVisibilityWhere(user) }, select: { id: true } }) : null,
    input.clientId ? prisma.client.findFirst({ where: { id: input.clientId, ...clientVisibilityWhere(user) }, select: { id: true } }) : null,
    input.assignedEmployeeId ? prisma.employee.findFirst({ where: { id: input.assignedEmployeeId, organizationId: user.organizationId }, select: { id: true } }) : null,
  ]);
  if (input.projectId && !project) fail(failPath, "That project was not found or you cannot access it.");
  if (input.clientId && !client) fail(failPath, "That client was not found or you cannot access it.");
  if (input.assignedEmployeeId && !employee) fail(failPath, "That employee was not found.");
  if (input.assignedEmployeeId && input.assignedEmployeeId !== user.employeeId && !canAssignOthers(user)) {
    fail(failPath, "You can only assign events to yourself.");
  }
  return {
    title: input.title, description: input.description, location: input.location, allDay: input.allDay,
    visibility: input.visibility, assignedEmployeeId: input.assignedEmployeeId, projectId: input.projectId, clientId: input.clientId,
    ...times,
  };
}

export async function createCalendarEvent(data: FormData) {
  const user = await requireAuthenticatedUser();
  const values = await prepare(user, data, "/calendar/events/new");
  const event = await prisma.calendarEvent.create({
    data: { ...values, organizationId: user.organizationId, createdByUserId: user.id, updatedByUserId: user.id },
  });
  redirect(`/calendar/events/${event.id}?success=Event created.`);
}

async function loadManageable(user: AuthenticatedUser, id: string) {
  const event = await prisma.calendarEvent.findFirst({
    where: { id, ...calendarEventVisibilityWhere(user) }, include: { project: { select: { projectManagerId: true } } },
  });
  if (!event) return fail("/calendar", "Event not found.");
  if (!canManageCalendarEvent(user, event!)) return redirect("/forbidden");
  return event!;
}

export async function updateCalendarEvent(data: FormData) {
  const user = await requireAuthenticatedUser();
  const id = String(data.get("id") ?? "");
  const existing = await loadManageable(user, id);
  if (existing.status === "CANCELLED") fail(`/calendar/events/${id}`, "Cancelled events cannot be edited.");
  const values = await prepare(user, data, `/calendar/events/${id}`);
  await prisma.calendarEvent.updateMany({ where: { id, organizationId: user.organizationId }, data: { ...values, updatedByUserId: user.id } });
  redirect(`/calendar/events/${id}?success=Event updated.`);
}

export async function cancelCalendarEvent(data: FormData) {
  const user = await requireAuthenticatedUser();
  const id = String(data.get("id") ?? "");
  await loadManageable(user, id);
  await prisma.calendarEvent.updateMany({
    where: { id, organizationId: user.organizationId, status: "SCHEDULED" },
    data: { status: "CANCELLED", cancelledAt: new Date(), updatedByUserId: user.id },
  });
  redirect(`/calendar/events/${id}?success=Event cancelled.`);
}
