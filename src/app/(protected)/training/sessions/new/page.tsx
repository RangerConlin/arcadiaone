import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Notice } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { todayKey } from "@/lib/datetime";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { createSession } from "@/modules/training/actions";
import { canManageSessions } from "@/modules/training/authorization";
import { listCourses } from "@/modules/training/data";
import { SessionForm } from "@/modules/training/session-form";

export const dynamic = "force-dynamic";

export default async function NewSessionPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireAuthenticatedUser();
  if (!canManageSessions(user)) redirect("/forbidden");
  const [query, zone, courses] = await Promise.all([searchParams, getViewerTimeZone(user), listCourses(user)]);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Training", href: "/training" }, { label: "Schedule session" }]} description="A session is one scheduled delivery of a course. It appears on the calendar automatically." title="Schedule a session" />
      <Notice message={query.error} tone="error" />
      <section className="max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        {courses.length ? <SessionForm action={createSession} courses={courses} defaultDate={todayKey(zone)} submitLabel="Create session" zone={zone} /> : <p className="text-sm">Define a course first under Administration → Training courses.</p>}
      </section>
    </>
  );
}
