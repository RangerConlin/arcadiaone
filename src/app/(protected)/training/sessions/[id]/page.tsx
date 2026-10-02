import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentSection } from "@/components/document-section";
import { PageHeader } from "@/components/page-header";
import { Field, inputClass, Notice, SecondaryLink, StatusBadge, SubmitButton } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { dateKeyUtc, formatDateTimeInZone } from "@/lib/datetime";
import { formatName } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { attachSessionDocument, cancelSessionAction, completeSessionAction, createSuggestedQualificationAction, enrollEmployees, leaveSession, saveOutcome, selfEnroll, updateSession } from "@/modules/training/actions";
import { canManageSessions, canSelfEnroll, getTrainingPolicy, sessionVisibilityWhere } from "@/modules/training/authorization";
import { SessionForm } from "@/modules/training/session-form";

export const dynamic = "force-dynamic";

export default async function SessionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ success?: string; error?: string }> }) {
  const [user, { id }, query] = await Promise.all([requireAuthenticatedUser(), params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await prisma.trainingSession.findFirst({
    where: { id, ...sessionVisibilityWhere(user) },
    include: {
      trainingCourse: { include: { qualificationLinks: { include: { qualificationType: { select: { id: true, name: true } } } } } },
      enrollments: { include: { employee: true, employeeQualification: { include: { qualificationType: { select: { name: true } } } } }, orderBy: { employee: { lastName: "asc" } } },
    },
  });
  if (!session) notFound();
  const [zone, policy] = await Promise.all([getViewerTimeZone(user), getTrainingPolicy(user.organizationId)]);
  const staff = canManageSessions(user);
  const closed = session.status === "COMPLETED" || session.status === "CANCELLED";
  const title = session.titleOverride ?? session.trainingCourse.name;
  const mine = session.enrollments.find((e) => e.employeeId === user.employeeId);
  const visibleEnrollments = staff ? session.enrollments : session.enrollments.filter((e) => e.employeeId === user.employeeId);
  const active = session.enrollments.filter((e) => e.status !== "CANCELLED");
  const enrolledIds = new Set(active.map((e) => e.employeeId));
  const candidates = staff && !closed ? await prisma.employee.findMany({ where: { organizationId: user.organizationId, employmentStatus: { in: ["ACTIVE", "LEAVE"] } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 500 }) : [];
  const courses = staff && !closed ? await prisma.trainingCourse.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true } }) : [];
  const scheduledHours = session.endAt ? Math.round(((session.endAt.getTime() - session.startAt.getTime()) / 3_600_000) * 100) / 100 : null;
  return (
    <>
      <PageHeader actions={<SecondaryLink href="/training">Back to training</SecondaryLink>} breadcrumbs={[{ label: "Training", href: "/training" }, { label: title }]} title={title} />
      <Notice message={query.success} tone="success" />
      <Notice message={query.error} tone="error" />
      <section className="mb-6 max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <div className="mb-3 flex items-center gap-2"><StatusBadge status={session.status} /></div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold">When</dt><dd>{formatDateTimeInZone(session.startAt, zone)}{session.endAt ? ` – ${formatDateTimeInZone(session.endAt, zone)}` : ""}</dd></div>
          <div><dt className="font-semibold">Location</dt><dd>{session.location ?? "—"}</dd></div>
          <div><dt className="font-semibold">Instructor</dt><dd>{session.instructor ?? "—"}</dd></div>
          <div><dt className="font-semibold">Provider</dt><dd>{session.providerOverride ?? session.trainingCourse.provider ?? "—"}</dd></div>
          <div><dt className="font-semibold">Participants</dt><dd>{active.length}{session.maxParticipants ? ` of ${session.maxParticipants}` : ""}</dd></div>
          <div><dt className="font-semibold">Scheduled length</dt><dd>{scheduledHours !== null ? `${scheduledHours} h (actual hours are recorded per participant)` : "—"}</dd></div>
        </dl>
        {session.notes ? <p className="mt-3 whitespace-pre-wrap text-sm">{session.notes}</p> : null}
        {!staff && !mine && canSelfEnroll(user, policy, session) ? <form action={selfEnroll} className="mt-4"><input name="sessionId" type="hidden" value={session.id} /><SubmitButton>Enroll me</SubmitButton></form> : null}
        {!staff && mine?.status === "ENROLLED" && !closed ? <form action={leaveSession} className="mt-4"><input name="sessionId" type="hidden" value={session.id} /><button className="cal-btn" type="submit">Cancel my enrollment</button></form> : null}
      </section>

      <section className="mb-6 max-w-5xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)]">
        <h2 className="p-4 text-base font-semibold">{staff ? "Participants and attendance" : "Your enrollment"}</h2>
        {visibleEnrollments.length === 0 ? <p className="px-4 pb-4 text-sm text-[color:var(--muted)]">No participants yet.</p> : null}
        <ul>
          {visibleEnrollments.map((e) => {
            const suggestions = e.status === "COMPLETED" ? session.trainingCourse.qualificationLinks.filter((l) => l.effect === "SUGGEST") : [];
            return (
              <li className="border-t border-[color:var(--border)] p-4" key={e.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><strong>{formatName(e.employee)}</strong> <StatusBadge status={e.status} />
                    {e.status === "COMPLETED" ? <span className="ml-2 text-sm text-[color:var(--muted)]">{e.completionDate ? dateKeyUtc(e.completionDate) : ""} · {e.hoursCompleted ? `${e.hoursCompleted.toFixed(2)} h` : "hours not recorded"}{e.passed === null ? "" : e.passed ? " · passed" : " · did not pass"}{e.score ? ` · score ${e.score.toFixed(2)}` : ""}</span> : null}
                    {e.employeeQualification ? <span className="ml-2 text-sm">→ <Link className="underline" href={`/people/${e.employeeId}`}>{e.employeeQualification.qualificationType.name} ({e.employeeQualification.verificationStatus.toLowerCase()})</Link></span> : null}
                  </div>
                </div>
                {staff && session.status !== "CANCELLED" ? (
                  <form action={saveOutcome} className="mt-3 grid items-end gap-2 sm:grid-cols-3 lg:grid-cols-7">
                    <input name="sessionId" type="hidden" value={session.id} /><input name="enrollmentId" type="hidden" value={e.id} />
                    <label className="grid gap-1 text-xs font-semibold">Status<select className={inputClass} defaultValue={e.status} name="status">{["ENROLLED", "ATTENDED", "COMPLETED", "NO_SHOW", "CANCELLED"].map((s) => <option key={s} value={s}>{s.toLowerCase().replace("_", " ")}</option>)}</select></label>
                    <label className="grid gap-1 text-xs font-semibold">Completed on<input className={inputClass} defaultValue={e.completionDate ? dateKeyUtc(e.completionDate) : ""} name="completionDate" type="date" /></label>
                    <label className="grid gap-1 text-xs font-semibold">Actual hours<input className={inputClass} defaultValue={e.hoursCompleted?.toFixed(2) ?? ""} inputMode="decimal" name="hoursCompleted" placeholder={scheduledHours !== null ? `scheduled ${scheduledHours}` : "hours"} /></label>
                    <label className="grid gap-1 text-xs font-semibold">Score (optional)<input className={inputClass} defaultValue={e.score?.toFixed(2) ?? ""} inputMode="decimal" name="score" /></label>
                    <label className="grid gap-1 text-xs font-semibold">Result<select className={inputClass} defaultValue={e.passed === null ? "" : String(e.passed)} name="passed"><option value="">Not graded</option><option value="true">Passed</option><option value="false">Did not pass</option></select></label>
                    <label className="grid gap-1 text-xs font-semibold">Notes<input className={inputClass} defaultValue={e.notes ?? ""} maxLength={2000} name="notes" /></label>
                    <button className="cal-btn" type="submit">Save</button>
                  </form>
                ) : null}
                {staff && suggestions.length ? suggestions.map((l) => (
                  <form action={createSuggestedQualificationAction} className="mt-2 flex items-center gap-2 text-sm" key={l.id}>
                    <input name="kind" type="hidden" value="enrollment" /><input name="id" type="hidden" value={e.id} /><input name="qualificationTypeId" type="hidden" value={l.qualificationTypeId} /><input name="returnTo" type="hidden" value={`/training/sessions/${session.id}`} />
                    <span>Suggested qualification: <strong>{l.qualificationType.name}</strong></span><button className="notif-btn" type="submit">Create as unverified</button>
                  </form>
                )) : null}
              </li>
            );
          })}
        </ul>
        {staff && !closed ? (
          <form action={enrollEmployees} className="grid gap-2 border-t border-[color:var(--border)] p-4 sm:grid-cols-[1fr_auto]">
            <input name="sessionId" type="hidden" value={session.id} />
            <label className="grid gap-1 text-xs font-semibold">Add participants (hold Ctrl/Cmd to select several)
              <select className={`${inputClass} min-h-32`} multiple name="employeeId">{candidates.filter((c) => !enrolledIds.has(c.id)).map((c) => <option key={c.id} value={c.id}>{formatName(c)}</option>)}</select>
            </label>
            <div className="self-end"><SubmitButton>Enroll selected</SubmitButton></div>
          </form>
        ) : null}
      </section>

      {staff && !closed ? (
        <section className="mb-6 grid max-w-5xl gap-4 lg:grid-cols-2">
          <form action={completeSessionAction} className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4">
            <input name="sessionId" type="hidden" value={session.id} />
            <h2 className="mb-2 text-base font-semibold">Complete session</h2>
            <p className="mb-2 text-sm text-[color:var(--muted)]">Record each participant&apos;s outcome first. Completing locks the session.</p>
            <label className="mb-3 flex items-center gap-2 text-sm"><input name="markNoShow" type="checkbox" /> Mark anyone still only enrolled as a no-show</label>
            <SubmitButton>Complete session</SubmitButton>
          </form>
          <form action={cancelSessionAction} className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4">
            <input name="sessionId" type="hidden" value={session.id} />
            <h2 className="mb-2 text-base font-semibold">Cancel session</h2>
            <Field label="Reason (shared in the record, not sent to participants)"><input className={inputClass} maxLength={300} name="reason" /></Field>
            <button className="cal-btn mt-3" type="submit">Cancel session</button>
          </form>
        </section>
      ) : null}

      {staff && !closed ? (
        <section className="mb-6 max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
          <h2 className="mb-3 text-base font-semibold">Edit session</h2>
          <SessionForm action={updateSession} courses={courses} submitLabel="Save changes" value={session} zone={zone} defaultDate="" />
          <p className="mt-2 text-xs text-[color:var(--muted)]">Changing the time or location notifies enrolled participants.</p>
        </section>
      ) : null}

      <div className="max-w-4xl">
        <DocumentSection relationId={session.id} relationType="trainingSessionId" returnTo={`/training/sessions/${session.id}`} />
        {staff ? (
          <form action={attachSessionDocument} className="mt-3 grid items-end gap-2 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4 sm:grid-cols-[1fr_1fr_auto]" encType="multipart/form-data">
            <input name="sessionId" type="hidden" value={session.id} />
            <label className="grid gap-1 text-xs font-semibold">Title (roster, materials, attendance sheet…)<input className={inputClass} maxLength={200} name="title" required /></label>
            <label className="grid gap-1 text-xs font-semibold">File<input className={inputClass} name="file" required type="file" /></label>
            <button className="cal-btn" type="submit">Attach</button>
          </form>
        ) : null}
      </div>
    </>
  );
}
