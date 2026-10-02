import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedUser } from "@/lib/auth/session";
import { addDays, dateKeyInZone, dateKeyUtc, keyToDate, startOfDayUtc } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { formatName } from "@/lib/format";
import { clientVisibilityWhere } from "@/modules/clients/authorization";
import { invoiceVisibilityWhere } from "@/modules/invoices/authorization";
import { projectVisibilityWhere } from "@/modules/projects/authorization";
import { getQualificationStatus } from "@/modules/qualifications/status";
import { CLOSED_TASK_STATUSES } from "@/modules/tasks/constants";
import { taskVisibilityWhere } from "@/modules/tasks/authorization";
import { sessionVisibilityWhere } from "@/modules/training/authorization";
import { calendarEventVisibilityWhere, signatureVisibilityWhere } from "./authorization";
import type { CalendarItem, CalendarRange } from "./types";

/**
 * Every source reads its own module's table, constrained by that module's visibility
 * policy, and maps rows to read-only CalendarItems. Nothing here writes, and no source
 * data is copied into CalendarEvent.
 */

const PER_SOURCE_LIMIT = 500;

export type SourceContext = {
  user: AuthenticatedUser;
  zone: string;
  range: CalendarRange;
  /** Date-only window [dateFrom, dateTo) in UTC midnight terms. */
  dateFrom: Date;
  dateTo: Date;
  /** Instant window [instantFrom, instantTo) in the viewer's zone. */
  instantFrom: Date;
  instantTo: Date;
  projectId?: string;
  clientId?: string;
  /** Effective employee filter (explicit filter, or the viewer when "assigned to me"). */
  employeeId?: string;
  departmentId?: string;
  mine: boolean;
  showCompleted: boolean;
  warningDays: number;
  now: Date;
};

export function buildContext(
  user: AuthenticatedUser,
  zone: string,
  range: CalendarRange,
  filters: { projectId?: string; clientId?: string; employeeId?: string; departmentId?: string; mine: boolean; showCompleted: boolean },
  org: { qualificationExpirationWarningDays: number },
  now = new Date(),
): SourceContext {
  return {
    user, zone, range,
    dateFrom: keyToDate(range.fromKey),
    dateTo: keyToDate(addDays(range.toKey, 1)),
    instantFrom: startOfDayUtc(range.fromKey, zone),
    instantTo: startOfDayUtc(addDays(range.toKey, 1), zone),
    projectId: filters.projectId,
    clientId: filters.clientId,
    employeeId: filters.mine ? (user.employeeId ?? "__none__") : filters.employeeId,
    departmentId: filters.departmentId,
    mine: filters.mine,
    showCompleted: filters.showCompleted,
    warningDays: org.qualificationExpirationWarningDays,
    now,
  };
}

const dateWindow = (ctx: SourceContext) => ({ gte: ctx.dateFrom, lt: ctx.dateTo });
const instantWindow = (ctx: SourceContext) => ({ gte: ctx.instantFrom, lt: ctx.instantTo });
const personName = (employee?: { firstName: string; preferredName: string | null; lastName: string; suffix: string | null } | null) =>
  employee ? formatName(employee) : null;

/** A date-only item (no time of day, no zone conversion). */
function dateOnly(item: Omit<CalendarItem, "startKey" | "endKey" | "allDay">, date: Date, endDate?: Date | null): CalendarItem {
  const startKey = dateKeyUtc(date);
  const endKey = endDate ? dateKeyUtc(endDate) : startKey;
  return { ...item, startKey, endKey: endKey < startKey ? startKey : endKey, allDay: true };
}

/** An instant-based item, bucketed into days of the viewer's zone. */
function timed(item: Omit<CalendarItem, "startKey" | "endKey" | "allDay" | "startAt" | "endAt">, ctx: SourceContext, start: Date, end?: Date | null): CalendarItem {
  const startKey = dateKeyInZone(start, ctx.zone);
  // An end exactly at local midnight belongs to the previous day.
  const endKey = end ? dateKeyInZone(new Date(Math.max(end.getTime() - 1, start.getTime())), ctx.zone) : startKey;
  return { ...item, startKey, endKey: endKey < startKey ? startKey : endKey, allDay: false, startAt: start, endAt: end ?? undefined };
}

/** Employee-facing filters that exist on Employee rows (department / explicit employee). */
function employeeConditions(ctx: SourceContext): Prisma.EmployeeWhereInput {
  return { ...(ctx.employeeId ? { id: ctx.employeeId } : {}), ...(ctx.departmentId ? { departmentId: ctx.departmentId } : {}) };
}
const hasEmployeeFilter = (ctx: SourceContext) => Boolean(ctx.employeeId || ctx.departmentId);

/** Project involvement: manager or active member matching the employee filters. */
function projectInvolvement(ctx: SourceContext): Prisma.ProjectWhereInput[] {
  if (!hasEmployeeFilter(ctx)) return [];
  const employee = employeeConditions(ctx);
  return [{ OR: [{ projectManager: employee }, { members: { some: { leftAt: null, employee } } }] }];
}

// ---------------------------------------------------------------------------

export async function projectItems(ctx: SourceContext): Promise<CalendarItem[]> {
  const window = dateWindow(ctx);
  const projects = await prisma.project.findMany({
    where: {
      AND: [
        projectVisibilityWhere(ctx.user),
        { status: { not: "ARCHIVED" } },
        ...(ctx.projectId ? [{ id: ctx.projectId }] : []),
        ...(ctx.clientId ? [{ clientId: ctx.clientId }] : []),
        ...projectInvolvement(ctx),
        { OR: [{ startDate: window }, { targetEndDate: window }, { actualEndDate: window }] },
      ],
    },
    include: { client: { select: { name: true } }, projectManager: true },
    take: PER_SOURCE_LIMIT,
  });
  const inRange = (date: Date | null) => date !== null && date >= ctx.dateFrom && date < ctx.dateTo;
  return projects.flatMap((project) => {
    const closed = ["COMPLETED", "CANCELLED"].includes(project.status);
    const base = {
      type: "PROJECT" as const, href: `/projects/${project.id}`, status: project.status, closed,
      projectName: project.name, clientName: project.client?.name ?? project.clientName,
      assigneeName: personName(project.projectManager),
    };
    const items: CalendarItem[] = [];
    if (inRange(project.startDate)) items.push(dateOnly({ ...base, key: `project:${project.id}:start`, kind: "Starts", title: `${project.name} starts` }, project.startDate!));
    if (inRange(project.targetEndDate)) items.push(dateOnly({ ...base, key: `project:${project.id}:target`, kind: "Target end", title: `${project.name} target end` }, project.targetEndDate!));
    if (inRange(project.actualEndDate)) items.push(dateOnly({ ...base, key: `project:${project.id}:actual`, kind: "Ended", title: `${project.name} ended` }, project.actualEndDate!));
    return items;
  });
}

export async function milestoneItems(ctx: SourceContext): Promise<CalendarItem[]> {
  const milestones = await prisma.projectMilestone.findMany({
    where: {
      targetDate: dateWindow(ctx),
      status: ctx.showCompleted ? undefined : { notIn: ["COMPLETED", "CANCELLED"] },
      project: {
        AND: [
          projectVisibilityWhere(ctx.user),
          ...(ctx.projectId ? [{ id: ctx.projectId }] : []),
          ...(ctx.clientId ? [{ clientId: ctx.clientId }] : []),
          ...projectInvolvement(ctx),
        ],
      },
    },
    include: { project: { select: { id: true, name: true, client: { select: { name: true } }, clientName: true } } },
    take: PER_SOURCE_LIMIT,
  });
  return milestones.map((milestone) =>
    dateOnly({
      key: `milestone:${milestone.id}`, type: "MILESTONE", kind: "Target", title: milestone.name,
      href: `/projects/${milestone.project.id}?tab=milestones`, status: milestone.status,
      closed: milestone.status === "COMPLETED" || milestone.status === "CANCELLED",
      overdue: milestone.targetDate! < ctx.now && !["COMPLETED", "CANCELLED"].includes(milestone.status) && dateKeyUtc(milestone.targetDate!) < dateKeyInZone(ctx.now, ctx.zone),
      projectName: milestone.project.name, clientName: milestone.project.client?.name ?? milestone.project.clientName,
    }, milestone.targetDate!),
  );
}

export async function taskItems(ctx: SourceContext): Promise<CalendarItem[]> {
  const window = dateWindow(ctx);
  const assignee: Prisma.EmployeeWhereInput = employeeConditions(ctx);
  const tasks = await prisma.task.findMany({
    where: {
      AND: [
        taskVisibilityWhere(ctx.user),
        ...(ctx.showCompleted ? [] : [{ status: { notIn: [...CLOSED_TASK_STATUSES] } }]),
        ...(ctx.projectId ? [{ projectId: ctx.projectId }] : []),
        ...(ctx.clientId ? [{ project: { clientId: ctx.clientId } }] : []),
        ...(hasEmployeeFilter(ctx) ? [{ assignedTo: assignee }] : []),
        { OR: [{ dueDate: window }, { startDate: window }] },
      ],
    },
    include: { assignedTo: true, project: { select: { name: true, client: { select: { name: true } }, clientName: true } } },
    take: PER_SOURCE_LIMIT,
  });
  const today = dateKeyInZone(ctx.now, ctx.zone);
  const inRange = (date: Date | null) => date !== null && date >= ctx.dateFrom && date < ctx.dateTo;
  return tasks.flatMap((task) => {
    const closed = (CLOSED_TASK_STATUSES as readonly string[]).includes(task.status);
    const base = {
      type: "TASK" as const, href: `/tasks/${task.id}`, status: task.status, closed,
      projectName: task.project?.name ?? null, clientName: task.project?.client?.name ?? task.project?.clientName ?? null,
      assigneeName: personName(task.assignedTo),
    };
    const items: CalendarItem[] = [];
    if (inRange(task.dueDate)) {
      items.push(dateOnly({ ...base, key: `task:${task.id}:due`, kind: "Due", title: task.title, overdue: !closed && dateKeyUtc(task.dueDate!) < today }, task.dueDate!));
    }
    // A start marker is only useful when it falls on a different day than the due date.
    if (inRange(task.startDate) && (!task.dueDate || dateKeyUtc(task.startDate!) !== dateKeyUtc(task.dueDate))) {
      items.push(dateOnly({ ...base, key: `task:${task.id}:start`, kind: "Starts", title: `${task.title} (start)` }, task.startDate!));
    }
    return items;
  });
}

export async function qualificationItems(ctx: SourceContext): Promise<CalendarItem[]> {
  if (ctx.projectId || ctx.clientId) return [];
  const own = ctx.user.role === "EMPLOYEE";
  if (own && !ctx.user.employeeId) return [];
  const employee: Prisma.EmployeeWhereInput = {
    employmentStatus: { not: "TERMINATED" },
    ...employeeConditions(ctx),
    // Employees only ever see their own credentials; staff follow the qualifications module.
    ...(own ? { id: ctx.user.employeeId! } : {}),
  };
  if (own && ctx.employeeId && ctx.employeeId !== ctx.user.employeeId) return [];
  const rows = await prisma.employeeQualification.findMany({
    where: { organizationId: ctx.user.organizationId, archivedAt: null, expirationDate: dateWindow(ctx), employee },
    include: { employee: true, qualificationType: { select: { name: true } } },
    take: PER_SOURCE_LIMIT,
  });
  return rows.map((row) => {
    const status = getQualificationStatus(row.expirationDate, ctx.warningDays, ctx.now);
    return dateOnly({
      key: `qualification:${row.id}`, type: "QUALIFICATION", kind: "Expires",
      title: `${row.qualificationType.name} expires`, href: `/people/${row.employeeId}`,
      status, overdue: status === "EXPIRED", assigneeName: personName(row.employee),
    }, row.expirationDate!);
  });
}

export async function rentalItems(ctx: SourceContext): Promise<CalendarItem[]> {
  const responsible: Prisma.EmployeeWhereInput = employeeConditions(ctx);
  const involvement: Prisma.RentalWhereInput[] = hasEmployeeFilter(ctx)
    ? [{ OR: [{ preparedBy: responsible }, { checkedOutBy: responsible }, { receivedBy: responsible }, ...(ctx.mine ? [{ createdByUserId: ctx.user.id }] : [])] }]
    : [];
  const rentals = await prisma.rental.findMany({
    where: {
      AND: [
        { organizationId: ctx.user.organizationId },
        ...(ctx.projectId ? [{ projectId: ctx.projectId }] : []),
        ...(ctx.clientId ? [{ clientId: ctx.clientId }] : []),
        ...involvement,
        { status: { notIn: ctx.showCompleted ? ["DRAFT"] : ["DRAFT", "CANCELLED"] } },
        {
          OR: [
            { reservationStart: { lt: ctx.instantTo }, reservationEnd: { gte: ctx.instantFrom } },
            { checkedOutAt: instantWindow(ctx) },
            { returnedAt: instantWindow(ctx) },
          ],
        },
      ],
    },
    include: { client: { select: { name: true } }, project: { select: { name: true } }, checkedOutBy: true, preparedBy: true },
    take: PER_SOURCE_LIMIT,
  });
  return rentals.flatMap((rental) => {
    const closed = ["RETURNED", "CLOSED", "CANCELLED"].includes(rental.status);
    const outstanding = ["CHECKED_OUT", "PARTIALLY_RETURNED"].includes(rental.status);
    const base = {
      type: "RENTAL" as const, href: `/rentals/${rental.id}`, status: rental.status, closed,
      projectName: rental.project?.name ?? null, clientName: rental.client?.name ?? null,
      assigneeName: personName(rental.checkedOutBy ?? rental.preparedBy),
    };
    const items: CalendarItem[] = [];
    if (rental.reservationStart < ctx.instantTo && rental.reservationEnd >= ctx.instantFrom && (!closed || ctx.showCompleted || rental.status === "RETURNED" || rental.status === "CLOSED")) {
      items.push(timed({ ...base, key: `rental:${rental.id}:reservation`, kind: "Reservation", title: `Rental ${rental.rentalNumber}`, overdue: outstanding && rental.reservationEnd < ctx.now }, ctx, rental.reservationStart, rental.reservationEnd));
    }
    if (rental.checkedOutAt && rental.checkedOutAt >= ctx.instantFrom && rental.checkedOutAt < ctx.instantTo) {
      items.push(timed({ ...base, key: `rental:${rental.id}:checkout`, kind: "Checked out", title: `Rental ${rental.rentalNumber} checked out` }, ctx, rental.checkedOutAt));
    }
    if (rental.returnedAt && rental.returnedAt >= ctx.instantFrom && rental.returnedAt < ctx.instantTo) {
      items.push(timed({ ...base, key: `rental:${rental.id}:return`, kind: "Returned", title: `Rental ${rental.rentalNumber} returned` }, ctx, rental.returnedAt));
    }
    return items;
  });
}

export async function invoiceItems(ctx: SourceContext): Promise<CalendarItem[]> {
  // Financial records are never exposed to employees; the module's own policy decides the rest.
  if (ctx.user.role === "EMPLOYEE") return [];
  // Invoices carry no employee/department relationship.
  if ((ctx.employeeId && !ctx.mine) || ctx.departmentId) return [];
  const mineScope: Prisma.InvoiceWhereInput[] = ctx.mine
    ? [{ OR: [{ createdByUserId: ctx.user.id }, ...(ctx.user.employeeId ? [{ project: { projectManagerId: ctx.user.employeeId } }] : [])] }]
    : [];
  const invoices = await prisma.invoice.findMany({
    where: {
      AND: [
        invoiceVisibilityWhere(ctx.user),
        { dueDate: dateWindow(ctx) },
        { status: { notIn: ctx.showCompleted ? ["DRAFT", "VOID"] : ["DRAFT", "VOID", "PAID"] } },
        ...(ctx.projectId ? [{ projectId: ctx.projectId }] : []),
        ...(ctx.clientId ? [{ clientId: ctx.clientId }] : []),
        ...mineScope,
      ],
    },
    include: { client: { select: { name: true } }, project: { select: { name: true } } },
    take: PER_SOURCE_LIMIT,
  });
  return invoices.map((invoice) => {
    // Date-only comparison: an invoice is overdue the day *after* its due date, in the viewer's zone.
    const overdue = dateKeyUtc(invoice.dueDate!) < dateKeyInZone(ctx.now, ctx.zone) && Number(invoice.balanceDue) > 0;
    const status = overdue ? "OVERDUE" : invoice.status;
    return dateOnly({
      key: `invoice:${invoice.id}:due`, type: "INVOICE", kind: "Due",
      title: `${invoice.invoiceNumber ?? "Invoice"} due`, href: `/invoices/${invoice.id}`, status,
      closed: invoice.status === "PAID", overdue,
      projectName: invoice.project?.name ?? null, clientName: invoice.client.name,
      detail: `Balance ${invoice.currency} ${String(invoice.balanceDue)}`,
    }, invoice.dueDate!);
  });
}

export async function signatureItems(ctx: SourceContext): Promise<CalendarItem[]> {
  const signerFilter: Prisma.SignatureSignerWhereInput = { employee: employeeConditions(ctx) };
  const relation: Prisma.DocumentRelationWhereInput = {
    ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
    ...(ctx.clientId ? { clientId: ctx.clientId } : {}),
  };
  const requests = await prisma.signatureRequest.findMany({
    where: {
      AND: [
        signatureVisibilityWhere(ctx.user),
        { expiresAt: instantWindow(ctx), status: { in: ["SENT", "VIEWED", "PARTIALLY_SIGNED"] } },
        ...(Object.keys(relation).length ? [{ document: { relations: { some: relation } } }] : []),
        ...(hasEmployeeFilter(ctx)
          ? [{ OR: [{ signers: { some: signerFilter } }, ...(ctx.mine ? [{ requestedByUserId: ctx.user.id }] : [])] }]
          : []),
      ],
    },
    include: { signers: { select: { status: true } } },
    take: PER_SOURCE_LIMIT,
  });
  return requests.map((request) => {
    const pending = request.signers.filter((signer) => signer.status !== "SIGNED").length;
    return timed({
      key: `signature:${request.id}:expires`, type: "SIGNATURE", kind: "Signing deadline",
      title: `${request.title} signing deadline`, href: `/signatures/${request.id}`, status: request.status,
      overdue: false, detail: `${pending} signer${pending === 1 ? "" : "s"} outstanding`,
    }, ctx, request.expiresAt!);
  });
}

export async function approvalItems(ctx: SourceContext): Promise<CalendarItem[]> {
  if (ctx.user.role === "EMPLOYEE") return [];
  if ((ctx.employeeId && !ctx.mine) || ctx.departmentId) return [];
  const approvals = await prisma.clientApprovalRequest.findMany({
    where: {
      AND: [
        { organizationId: ctx.user.organizationId, status: "PENDING", client: clientVisibilityWhere(ctx.user) },
        ...(ctx.projectId ? [{ projectId: ctx.projectId }] : []),
        ...(ctx.clientId ? [{ clientId: ctx.clientId }] : []),
        ...(ctx.mine ? [{ requestedByUserId: ctx.user.id }] : []),
        { OR: [{ dueAt: instantWindow(ctx) }, { dueAt: null, requestedAt: instantWindow(ctx) }] },
      ],
    },
    include: { client: { select: { name: true } }, project: { select: { name: true } } },
    take: PER_SOURCE_LIMIT,
  });
  return approvals.map((approval) =>
    timed({
      key: `approval:${approval.id}`, type: "APPROVAL", kind: approval.dueAt ? "Response due" : "Requested",
      title: approval.dueAt ? `${approval.title} (approval due)` : `${approval.title} (approval requested)`,
      href: `/clients/${approval.clientId}?tab=portal`, status: approval.status,
      overdue: Boolean(approval.dueAt && approval.dueAt < ctx.now),
      projectName: approval.project?.name ?? null, clientName: approval.client.name,
    }, ctx, approval.dueAt ?? approval.requestedAt),
  );
}

export async function eventItems(ctx: SourceContext): Promise<CalendarItem[]> {
  const assignee: Prisma.EmployeeWhereInput = employeeConditions(ctx);
  const dayStart = ctx.range.fromKey;
  const dayEndExclusive = addDays(ctx.range.toKey, 1);
  const events = await prisma.calendarEvent.findMany({
    where: {
      AND: [
        calendarEventVisibilityWhere(ctx.user),
        ...(ctx.showCompleted ? [] : [{ status: "SCHEDULED" as const }]),
        ...(ctx.projectId ? [{ projectId: ctx.projectId }] : []),
        ...(ctx.clientId ? [{ clientId: ctx.clientId }] : []),
        ...(hasEmployeeFilter(ctx)
          ? [{ OR: [{ assignedEmployee: assignee }, ...(ctx.mine ? [{ createdByUserId: ctx.user.id }] : [])] }]
          : []),
        // Wide UTC pre-filter (one day of padding); exact bucketing happens below.
        { startAt: { lt: new Date(keyToDate(dayEndExclusive).getTime() + 86_400_000) }, OR: [{ endAt: { gte: new Date(keyToDate(dayStart).getTime() - 86_400_000) } }, { endAt: null, startAt: { gte: new Date(keyToDate(dayStart).getTime() - 86_400_000) } }] },
      ],
    },
    include: { assignedEmployee: true, project: { select: { name: true } }, client: { select: { name: true } } },
    orderBy: { startAt: "asc" },
    take: PER_SOURCE_LIMIT,
  });
  return events
    .map((event) => {
      const base = {
        key: `event:${event.id}`, type: "EVENT" as const, kind: event.allDay ? "All day" : "Event", title: event.title,
        href: `/calendar/events/${event.id}`, status: event.status, closed: event.status === "CANCELLED",
        projectName: event.project?.name ?? null, clientName: event.client?.name ?? null,
        assigneeName: personName(event.assignedEmployee), detail: event.location,
      };
      return event.allDay ? dateOnly(base, event.startAt, event.endAt) : timed(base, ctx, event.startAt, event.endAt);
    })
    .filter((item) => item.startKey < dayEndExclusive && item.endKey >= dayStart);
}

/** Training sessions come straight from TrainingSession; employees only see sessions they are in or that are open. */
export async function trainingItems(ctx: SourceContext): Promise<CalendarItem[]> {
  if (ctx.projectId || ctx.clientId) return [];
  const sessions = await prisma.trainingSession.findMany({
    where: {
      AND: [
        sessionVisibilityWhere(ctx.user),
        ctx.showCompleted ? {} : { status: { in: ["PLANNED", "OPEN"] } },
        { startAt: { lt: ctx.instantTo }, OR: [{ endAt: { gte: ctx.instantFrom } }, { endAt: null, startAt: { gte: ctx.instantFrom } }] },
        ...(hasEmployeeFilter(ctx) ? [{ enrollments: { some: { status: { not: "CANCELLED" as const }, employee: employeeConditions(ctx) } } }] : []),
      ],
    },
    include: { trainingCourse: { select: { name: true } }, _count: { select: { enrollments: { where: { status: { not: "CANCELLED" } } } } } },
    take: PER_SOURCE_LIMIT,
  });
  return sessions.map((session) =>
    timed({
      key: `training:${session.id}`, type: "TRAINING", kind: "Training session", title: session.titleOverride ?? session.trainingCourse.name, href: `/training/sessions/${session.id}`,
      status: session.status, closed: session.status === "CANCELLED" || session.status === "COMPLETED", assigneeName: session.instructor,
      detail: [session.location, `${session._count.enrollments}${session.maxParticipants ? `/${session.maxParticipants}` : ""} enrolled`].filter(Boolean).join(" · "),
    }, ctx, session.startAt, session.endAt),
  );
}

/** Next service dates come from active MaintenanceSchedule rows; nothing is copied into CalendarEvent. */
export async function maintenanceItems(ctx: SourceContext): Promise<CalendarItem[]> {
  if (ctx.projectId || ctx.clientId || ctx.departmentId) return [];
  const staff = ctx.user.role !== "EMPLOYEE";
  if (!staff && !ctx.user.employeeId) return [];
  const schedules = await prisma.maintenanceSchedule.findMany({
    where: {
      organizationId: ctx.user.organizationId, active: true, nextServiceDate: dateWindow(ctx), equipment: { active: true },
      ...(staff ? {} : { responsibleEmployeeId: ctx.user.employeeId! }),
      ...(ctx.employeeId ? { responsibleEmployeeId: ctx.employeeId } : {}),
    },
    include: { equipment: { select: { assetNumber: true, name: true } }, responsibleEmployee: true },
    take: PER_SOURCE_LIMIT,
  });
  const today = dateKeyInZone(ctx.now, ctx.zone);
  return schedules.map((schedule) =>
    dateOnly({
      key: `maintenance:${schedule.id}`, type: "MAINTENANCE", kind: "Service due", title: `${schedule.equipment.assetNumber} ${schedule.title ?? "service"} due`,
      href: `/rentals/equipment/${schedule.equipmentId}`, status: dateKeyUtc(schedule.nextServiceDate!) < today ? "OVERDUE" : "SCHEDULED",
      overdue: dateKeyUtc(schedule.nextServiceDate!) < today, assigneeName: personName(schedule.responsibleEmployee), detail: schedule.equipment.name,
    }, schedule.nextServiceDate!),
  );
}
