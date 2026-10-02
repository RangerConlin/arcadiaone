import { PageHeader } from "@/components/page-header";
import { Notice } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { isDayKey, todayKey } from "@/lib/datetime";
import { createCalendarEvent } from "@/modules/calendar/actions";
import { eventFormOptions } from "@/modules/calendar/event-data";
import { EventForm } from "@/modules/calendar/event-form";
import { getViewerTimeZone } from "@/modules/calendar/service";

export const dynamic = "force-dynamic";

export default async function NewEventPage({ searchParams }: { searchParams: Promise<{ error?: string; date?: string; project?: string }> }) {
  const user = await requireAuthenticatedUser();
  const [params, zone, options] = await Promise.all([searchParams, getViewerTimeZone(user), eventFormOptions(user)]);
  const defaultDate = isDayKey(params.date) ? params.date : todayKey(zone);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Calendar", href: "/calendar" }, { label: "New event" }]}
        description="Standalone events only. Tasks, rentals, invoices and other dated records already appear on the calendar from their own modules."
        title="New calendar event"
      />
      <Notice message={params.error} tone="error" />
      <section className="max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <EventForm {...options} action={createCalendarEvent} defaultDate={defaultDate} submitLabel="Create event" value={{ projectId: params.project }} zone={zone} />
      </section>
    </>
  );
}
