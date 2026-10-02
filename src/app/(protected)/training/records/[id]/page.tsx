import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentSection } from "@/components/document-section";
import { PageHeader } from "@/components/page-header";
import { Field, inputClass, Notice, SecondaryLink, StatusBadge } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { dateKeyUtc, formatDateTimeInZone, formatDayKey } from "@/lib/datetime";
import { formatName } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { attachRecordDocument, createSuggestedQualificationAction, rejectRecordAction, verifyRecordAction } from "@/modules/training/actions";
import { canSubmitRecordFor, canVerifyRecord, getTrainingPolicy, isTrainingStaff, recordVisibilityWhere } from "@/modules/training/authorization";

export const dynamic = "force-dynamic";

export default async function RecordPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ success?: string; error?: string }> }) {
  const [user, { id }, query] = await Promise.all([requireAuthenticatedUser(), params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const record = await prisma.employeeTrainingRecord.findFirst({
    where: { id, ...recordVisibilityWhere(user) },
    include: { employee: true, employeeQualification: { include: { qualificationType: true } }, trainingCourse: { include: { qualificationLinks: { include: { qualificationType: { select: { id: true, name: true } } } } } } },
  });
  if (!record) notFound();
  const [zone, policy] = await Promise.all([getViewerTimeZone(user), getTrainingPolicy(user.organizationId)]);
  const reviewer = canVerifyRecord(user, policy, record) && !record.verified;
  const staff = isTrainingStaff(user);
  const status = record.verified ? "verified" : record.rejectedAt ? "rejected" : "pending";
  const suggestions = record.verified ? (record.trainingCourse?.qualificationLinks ?? []).filter((l) => l.effect === "SUGGEST" && l.qualificationTypeId !== record.employeeQualification?.qualificationTypeId) : [];
  return (
    <>
      <PageHeader actions={<SecondaryLink href="/training?tab=records">Back to records</SecondaryLink>} breadcrumbs={[{ label: "Training", href: "/training?tab=records" }, { label: record.courseName }]} title={record.courseName} />
      <Notice message={query.success} tone="success" />
      <Notice message={query.error} tone="error" />
      <section className="mb-6 max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <div className="mb-3"><StatusBadge status={status} /></div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div><dt className="font-semibold">Employee</dt><dd>{staff ? <Link className="underline" href={`/people/${record.employeeId}`}>{formatName(record.employee)}</Link> : formatName(record.employee)}</dd></div>
          <div><dt className="font-semibold">Provider</dt><dd>{record.provider}</dd></div>
          <div><dt className="font-semibold">Completed</dt><dd>{formatDayKey(dateKeyUtc(record.completionDate))}</dd></div>
          <div><dt className="font-semibold">Hours</dt><dd>{record.hours ? `${record.hours.toFixed(2)} h` : "not stated"}</dd></div>
          <div><dt className="font-semibold">Certificate number</dt><dd>{record.certificateNumber ?? "—"}</dd></div>
          <div><dt className="font-semibold">Course</dt><dd>{record.trainingCourse?.name ?? "External (not in the course list)"}</dd></div>
          {record.verifiedAt ? <div><dt className="font-semibold">Verified</dt><dd>{formatDateTimeInZone(record.verifiedAt, zone)}</dd></div> : null}
          {record.rejectedAt ? <div><dt className="font-semibold">Rejected</dt><dd>{formatDateTimeInZone(record.rejectedAt, zone)} — {record.rejectionReason}</dd></div> : null}
          {record.employeeQualification ? <div><dt className="font-semibold">Related qualification</dt><dd><Link className="underline" href={`/people/${record.employeeId}`}>{record.employeeQualification.qualificationType.name}</Link> ({record.employeeQualification.verificationStatus.toLowerCase()})</dd></div> : null}
        </dl>
        {record.notes ? <p className="mt-3 whitespace-pre-wrap text-sm">{record.notes}</p> : null}
        {!record.verified && !reviewer && record.employeeId === user.employeeId ? <p className="mt-3 text-sm text-[color:var(--muted)]">You cannot verify your own training. Another reviewer will check it.</p> : null}
      </section>
      {reviewer ? (
        <section className="mb-6 grid max-w-4xl gap-4 lg:grid-cols-2">
          <form action={verifyRecordAction} className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4">
            <input name="id" type="hidden" value={record.id} /><h2 className="mb-2 text-base font-semibold">Verify</h2>
            <p className="mb-3 text-sm text-[color:var(--muted)]">Confirm the supporting document matches. Verifying does not grant a qualification unless the course is configured to.</p>
            <button className="cal-btn cal-btn-primary" type="submit">Verify record</button>
          </form>
          <form action={rejectRecordAction} className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4">
            <input name="id" type="hidden" value={record.id} /><h2 className="mb-2 text-base font-semibold">Reject</h2>
            <Field label="Reason"><input className={inputClass} maxLength={500} minLength={3} name="reason" required /></Field>
            <button className="cal-btn mt-3" type="submit">Reject record</button>
          </form>
        </section>
      ) : null}
      {staff && suggestions.map((l) => (
        <form action={createSuggestedQualificationAction} className="mb-4 flex max-w-4xl items-center gap-3 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-3 text-sm" key={l.id}>
          <input name="kind" type="hidden" value="record" /><input name="id" type="hidden" value={record.id} /><input name="qualificationTypeId" type="hidden" value={l.qualificationTypeId} /><input name="returnTo" type="hidden" value={`/training/records/${record.id}`} />
          <span>Suggested qualification: <strong>{l.qualificationType.name}</strong></span><button className="notif-btn" type="submit">Create as unverified</button>
        </form>
      ))}
      <div className="max-w-4xl">
        <DocumentSection relationId={record.id} relationType="trainingRecordId" returnTo={`/training/records/${record.id}`} />
        {canSubmitRecordFor(user, record.employeeId) && (!record.verified || staff) ? (
          <form action={attachRecordDocument} className="mt-3 grid items-end gap-2 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4 sm:grid-cols-[1fr_1fr_auto]" encType="multipart/form-data">
            <input name="recordId" type="hidden" value={record.id} />
            <label className="grid gap-1 text-xs font-semibold">Title<input className={inputClass} defaultValue={`Certificate — ${record.courseName}`} maxLength={200} name="title" /></label>
            <label className="grid gap-1 text-xs font-semibold">File<input className={inputClass} name="file" required type="file" /></label>
            <button className="cal-btn" type="submit">Attach document</button>
          </form>
        ) : null}
      </div>
    </>
  );
}
