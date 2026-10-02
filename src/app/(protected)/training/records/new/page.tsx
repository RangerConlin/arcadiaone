import { PageHeader } from "@/components/page-header";
import { Field, inputClass, Notice, SubmitButton } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { todayKey } from "@/lib/datetime";
import { formatName } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { submitRecordAction } from "@/modules/training/actions";
import { isTrainingStaff } from "@/modules/training/authorization";

export const dynamic = "force-dynamic";

export default async function NewRecordPage({ searchParams }: { searchParams: Promise<{ error?: string; employee?: string }> }) {
  const user = await requireAuthenticatedUser();
  const [query, zone] = await Promise.all([searchParams, getViewerTimeZone(user)]);
  const staff = isTrainingStaff(user);
  const [courses, employees] = await Promise.all([
    prisma.trainingCourse.findMany({ where: { organizationId: user.organizationId, active: true }, orderBy: { name: "asc" } }),
    staff ? prisma.employee.findMany({ where: { organizationId: user.organizationId, employmentStatus: { not: "TERMINATED" } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 500 }) : [],
  ]);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Training", href: "/training" }, { label: "Submit external training" }]}
        description={staff ? "Record training completed outside ArcadiaOne. It starts unverified." : "Submit training you completed elsewhere. A reviewer verifies it; you cannot verify your own."}
        title="Submit external training"
      />
      <Notice message={query.error} tone="error" />
      <form action={submitRecordAction} className="grid max-w-3xl gap-4 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5" encType="multipart/form-data">
        {staff ? (
          <Field label="Employee"><select className={inputClass} defaultValue={query.employee ?? user.employeeId ?? ""} name="employeeId" required><option value="">Choose an employee</option>{employees.map((e) => <option key={e.id} value={e.id}>{formatName(e)}</option>)}</select></Field>
        ) : null}
        <Field label="Matches a defined course (optional)">
          <select className={inputClass} name="trainingCourseId"><option value="">Not in the course list</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Course name"><input className={inputClass} maxLength={200} name="courseName" required /></Field>
          <Field label="Provider"><input className={inputClass} maxLength={160} name="provider" required /></Field>
          <Field label="Completion date"><input className={inputClass} max={todayKey(zone)} name="completionDate" required type="date" /></Field>
          <Field label="Hours (actual)"><input className={inputClass} inputMode="decimal" name="hours" placeholder="e.g. 8 or 7.5" /></Field>
          <Field label="Certificate number (optional)"><input className={inputClass} maxLength={120} name="certificateNumber" /></Field>
          <Field label="Certificate or supporting document (optional)"><input className={inputClass} name="file" type="file" /></Field>
        </div>
        <Field label="Notes"><textarea className={`${inputClass} min-h-20`} maxLength={2000} name="notes" /></Field>
        <div><SubmitButton>Submit for verification</SubmitButton></div>
      </form>
    </>
  );
}
