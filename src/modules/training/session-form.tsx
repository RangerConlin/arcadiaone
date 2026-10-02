import { Field, SubmitButton, inputClass } from "@/components/ui";
import { dateKeyInZone, timeInputInZone } from "@/lib/datetime";

type Course = { id: string; name: string };
export type SessionFormValue = { id?: string; trainingCourseId?: string; titleOverride?: string | null; startAt?: Date; endAt?: Date | null; location?: string | null; instructor?: string | null; providerOverride?: string | null; maxParticipants?: number | null; notes?: string | null; status?: string };

export function SessionForm({ action, courses, zone, value = {}, submitLabel, defaultDate }: { action: (data: FormData) => void | Promise<void>; courses: Course[]; zone: string; value?: SessionFormValue; submitLabel: string; defaultDate: string }) {
  const startDate = value.startAt ? dateKeyInZone(value.startAt, zone) : defaultDate;
  const startTime = value.startAt ? timeInputInZone(value.startAt, zone) : "09:00";
  const endDate = value.endAt ? dateKeyInZone(value.endAt, zone) : "";
  const endTime = value.endAt ? timeInputInZone(value.endAt, zone) : "";
  return (
    <form action={action} className="space-y-5">
      {value.id ? <input name="id" type="hidden" value={value.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Course">
          {value.id ? <><input name="trainingCourseId" type="hidden" value={value.trainingCourseId} /><p className="text-sm">{courses.find((c) => c.id === value.trainingCourseId)?.name}</p></> : (
            <select className={inputClass} defaultValue={value.trainingCourseId ?? ""} name="trainingCourseId" required><option value="">Choose a course</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          )}
        </Field>
        <Field label="Title override (optional)"><input className={inputClass} defaultValue={value.titleOverride ?? ""} maxLength={160} name="titleOverride" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Start date"><input className={inputClass} defaultValue={startDate} name="startDate" required type="date" /></Field>
        <Field label="Start time"><input className={inputClass} defaultValue={startTime} name="startTime" required type="time" /></Field>
        <Field label="End date (optional)"><input className={inputClass} defaultValue={endDate} name="endDate" type="date" /></Field>
        <Field label="End time (optional)"><input className={inputClass} defaultValue={endTime} name="endTime" type="time" /></Field>
      </div>
      <p className="text-xs text-[color:var(--muted)]">Times are entered in your time zone ({zone}) and stored in UTC.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Location"><input className={inputClass} defaultValue={value.location ?? ""} maxLength={200} name="location" /></Field>
        <Field label="Instructor"><input className={inputClass} defaultValue={value.instructor ?? ""} maxLength={160} name="instructor" /></Field>
        <Field label="Provider (if different from the course)"><input className={inputClass} defaultValue={value.providerOverride ?? ""} maxLength={160} name="providerOverride" /></Field>
        <Field label="Maximum participants"><input className={inputClass} defaultValue={value.maxParticipants ?? ""} min={1} name="maxParticipants" type="number" /></Field>
      </div>
      <Field label="Enrollment">
        <select className={inputClass} defaultValue={value.status === "OPEN" ? "OPEN" : "PLANNED"} name="status">
          <option value="PLANNED">Planned — staff enroll participants</option>
          <option value="OPEN">Open — employees may enroll themselves (if enabled)</option>
        </select>
      </Field>
      <Field label="Notes"><textarea className={`${inputClass} min-h-20`} defaultValue={value.notes ?? ""} maxLength={4000} name="notes" /></Field>
      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}
