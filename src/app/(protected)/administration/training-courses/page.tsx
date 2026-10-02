import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Field, inputClass, Notice, SubmitButton } from "@/components/ui";
import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { removeCourseQualification, saveCourse, saveCourseQualification } from "@/modules/training/actions";
import { getTrainingPolicy } from "@/modules/training/authorization";
import { listCourses } from "@/modules/training/data";
import { DELIVERY_LABELS, DELIVERY_METHODS, EFFECT_LABELS, QUALIFICATION_EFFECTS } from "@/modules/training/validation";

export const dynamic = "force-dynamic";

function CourseFields({ course }: { course?: { name: string; code: string | null; provider: string | null; defaultDurationHours: { toFixed(n: number): string } | null; deliveryMethod: string | null; description: string | null } }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Field label="Name"><input className={inputClass} defaultValue={course?.name} maxLength={160} name="name" required /></Field>
      <Field label="Code"><input className={inputClass} defaultValue={course?.code ?? ""} maxLength={40} name="code" /></Field>
      <Field label="Default provider"><input className={inputClass} defaultValue={course?.provider ?? ""} maxLength={160} name="provider" /></Field>
      <Field label="Default hours"><input className={inputClass} defaultValue={course?.defaultDurationHours?.toFixed(2) ?? ""} inputMode="decimal" name="defaultDurationHours" /></Field>
      <Field label="Delivery">
        <select className={inputClass} defaultValue={course?.deliveryMethod ?? ""} name="deliveryMethod"><option value="">Not specified</option>{DELIVERY_METHODS.map((m) => <option key={m} value={m}>{DELIVERY_LABELS[m]}</option>)}</select>
      </Field>
      <div className="sm:col-span-2 lg:col-span-5"><Field label="Description"><input className={inputClass} defaultValue={course?.description ?? ""} maxLength={2000} name="description" /></Field></div>
    </div>
  );
}

export default async function TrainingCoursesAdminPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const user = await requireRole("ADMIN");
  const query = await searchParams;
  const [courses, types, policy] = await Promise.all([
    listCourses(user, true),
    prisma.qualificationType.findMany({ where: { organizationId: user.organizationId, active: true }, orderBy: { name: "asc" } }),
    getTrainingPolicy(user.organizationId),
  ]);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Administration", href: "/administration" }, { label: "Training courses" }]}
        description="Reusable course definitions. A course may optionally lead to qualifications, but completing one never grants a verified qualification unless you configure that explicitly."
        title="Training courses"
      />
      <Notice message={query.success} tone="success" />
      <Notice message={query.error} tone="error" />
      <section className="mb-6 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <h2 className="mb-3 text-base font-semibold">Add course</h2>
        <form action={saveCourse} className="grid gap-3"><CourseFields /><div><SubmitButton>Add course</SubmitButton></div></form>
      </section>
      <div className="grid gap-4">
        {courses.map((course) => (
          <section className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5" key={course.id}>
            <form action={saveCourse} className="grid gap-3">
              <input name="id" type="hidden" value={course.id} />
              <CourseFields course={course} />
              <div className="flex flex-wrap items-center gap-3">
                <select aria-label="Status" className={`${inputClass} max-w-40`} defaultValue={String(course.active)} name="active"><option value="true">Active</option><option value="false">Inactive</option></select>
                <SubmitButton>Save</SubmitButton>
                <span className="text-xs text-[color:var(--muted)]">{course._count.sessions} session{course._count.sessions === 1 ? "" : "s"}</span>
              </div>
            </form>
            <div className="mt-4 border-t border-[color:var(--border)] pt-3">
              <h3 className="text-sm font-semibold">Qualification linkage</h3>
              {course.qualificationLinks.length === 0 ? <p className="text-sm text-[color:var(--muted)]">None. Completing this course has no qualification effect.</p> : null}
              <ul className="mt-1 grid gap-1 text-sm">
                {course.qualificationLinks.map((link) => (
                  <li className="flex flex-wrap items-center gap-2" key={link.id}>
                    <form action={saveCourseQualification} className="flex flex-wrap items-center gap-2">
                      <input name="trainingCourseId" type="hidden" value={course.id} /><input name="qualificationTypeId" type="hidden" value={link.qualificationTypeId} />
                      <strong>{link.qualificationType.name}</strong>
                      <select aria-label="Effect" className={`${inputClass} max-w-xs`} defaultValue={link.effect} name="effect">{QUALIFICATION_EFFECTS.map((e) => <option key={e} value={e}>{EFFECT_LABELS[e]}</option>)}</select>
                      <button className="notif-btn" type="submit">Update</button>
                    </form>
                    <form action={removeCourseQualification}><input name="id" type="hidden" value={link.id} /><button className="notif-btn" type="submit">Remove</button></form>
                  </li>
                ))}
              </ul>
              <form action={saveCourseQualification} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <input name="trainingCourseId" type="hidden" value={course.id} />
                <select aria-label="Qualification type" className={`${inputClass} max-w-xs`} name="qualificationTypeId" required><option value="">Link a qualification…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                <select aria-label="Effect" className={`${inputClass} max-w-xs`} defaultValue="SUGGEST" name="effect">{QUALIFICATION_EFFECTS.map((e) => <option key={e} value={e}>{EFFECT_LABELS[e]}</option>)}</select>
                <button className="notif-btn" type="submit">Add link</button>
              </form>
              {!policy.allowVerifiedQualification ? <p className="mt-1 text-xs text-[color:var(--muted)]">Verified grants are disabled by policy (<Link className="underline" href="/administration/lifecycle">change</Link>).</p> : null}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
