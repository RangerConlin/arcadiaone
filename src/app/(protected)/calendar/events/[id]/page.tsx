import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Notice, SecondaryLink, StatusBadge } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { dateKeyUtc, formatDateTimeInZone, formatDayKey } from "@/lib/datetime";
import { formatName } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { cancelCalendarEvent, updateCalendarEvent } from "@/modules/calendar/actions";
import { calendarEventVisibilityWhere, canManageCalendarEvent } from "@/modules/calendar/authorization";
import { eventFormOptions } from "@/modules/calendar/event-data";
import { EventForm } from "@/modules/calendar/event-form";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { TypeBadge } from "@/modules/calendar/views";

export const dynamic = "force-dynamic";

const VISIBILITY = { PRIVATE: "Only the creator and assignee", PROJECT: "People on the linked project", ORGANIZATION: "Everyone in the organization" } as const;

export default async function EventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; success?: string }> }) {
  const [{ id }, query, user] = await Promise.all([params, searchParams, requireAuthenticatedUser()]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const event = await prisma.calendarEvent.findFirst({
    where: { id, ...calendarEventVisibilityWhere(user) },
    include: {
      project: { select: { id: true, name: true, projectManagerId: true } }, client: { select: { id: true, name: true } },
      assignedEmployee: true, createdBy: { include: { employee: true } },
    },
  });
  if (!event) notFound();
  const [zone, options] = await Promise.all([getViewerTimeZone(user), eventFormOptions(user)]);
  const editable = canManageCalendarEvent(user, event) && event.status === "SCHEDULED";
  const when = event.allDay
    ? `${formatDayKey(dateKeyUtc(event.startAt))}${event.endAt ? ` – ${formatDayKey(dateKeyUtc(event.endAt))}` : ""} (all day)`
    : `${formatDateTimeInZone(event.startAt, zone)}${event.endAt ? ` – ${formatDateTimeInZone(event.endAt, zone)}` : ""} (${zone})`;
  return (
    <>
      <PageHeader
        actions={<SecondaryLink href="/calendar">Back to calendar</SecondaryLink>}
        breadcrumbs={[{ label: "Calendar", href: "/calendar" }, { label: event.title }]}
        title={event.title}
      />
      <Notice message={query.success} tone="success" />
      <Notice message={query.error} tone="error" />
      <section className="mb-6 max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2"><TypeBadge type="EVENT" /><StatusBadge status={event.status} /></div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold">When</dt><dd>{when}</dd></div>
          {event.location ? <div><dt className="font-semibold">Location</dt><dd>{event.location}</dd></div> : null}
          <div><dt className="font-semibold">Visible to</dt><dd>{VISIBILITY[event.visibility]}</dd></div>
          {event.assignedEmployee ? <div><dt className="font-semibold">Assigned to</dt><dd>{formatName(event.assignedEmployee)}</dd></div> : null}
          {event.project ? <div><dt className="font-semibold">Project</dt><dd><a className="underline" href={`/projects/${event.project.id}`}>{event.project.name}</a></dd></div> : null}
          {event.client ? <div><dt className="font-semibold">Client</dt><dd><a className="underline" href={`/clients/${event.client.id}`}>{event.client.name}</a></dd></div> : null}
          <div><dt className="font-semibold">Created by</dt><dd>{event.createdBy.employee ? formatName(event.createdBy.employee) : event.createdBy.email}</dd></div>
        </dl>
        {event.description ? <p className="mt-4 whitespace-pre-wrap text-sm">{event.description}</p> : null}
      </section>
      {editable ? (
        <section className="max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
          <h2 className="mb-4 text-base font-semibold">Edit event</h2>
          <EventForm {...options} action={updateCalendarEvent} submitLabel="Save changes" value={event} zone={zone} />
          <form action={cancelCalendarEvent} className="mt-6 border-t border-[color:var(--border)] pt-4">
            <input name="id" type="hidden" value={event.id} />
            <button className="cal-btn" type="submit">Cancel this event</button>
            <p className="mt-2 text-xs text-[color:var(--muted)]">Cancelled events stay on record but disappear from the calendar unless “Include completed and cancelled” is on.</p>
          </form>
        </section>
      ) : null}
    </>
  );
}
