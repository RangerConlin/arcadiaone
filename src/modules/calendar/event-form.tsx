import { Field, SubmitButton, inputClass } from "@/components/ui";
import { dateKeyUtc, dateKeyInZone, timeInputInZone } from "@/lib/datetime";
import { formatName } from "@/lib/format";

type Option = { id: string; name: string };
type EmployeeOption = { id: string; firstName: string; preferredName: string | null; lastName: string; suffix: string | null };

export type EventFormValue = {
  id?: string; title?: string; description?: string | null; location?: string | null; allDay?: boolean;
  startAt?: Date; endAt?: Date | null; visibility?: string; assignedEmployeeId?: string | null; projectId?: string | null; clientId?: string | null;
};

/** Prefills the editor from stored values, in the viewer's zone for timed events and UTC dates for all-day events. */
function initial(value: EventFormValue, zone: string, defaultDate?: string) {
  if (!value.startAt) return { startDate: defaultDate ?? "", startTime: "09:00", endDate: "", endTime: "" };
  if (value.allDay) {
    return { startDate: dateKeyUtc(value.startAt), startTime: "09:00", endDate: value.endAt ? dateKeyUtc(value.endAt) : "", endTime: "" };
  }
  return {
    startDate: dateKeyInZone(value.startAt, zone), startTime: timeInputInZone(value.startAt, zone),
    endDate: value.endAt ? dateKeyInZone(value.endAt, zone) : "", endTime: value.endAt ? timeInputInZone(value.endAt, zone) : "",
  };
}

export function EventForm({
  action, value = {}, zone, projects, clients, employees, canPublish, canAssign, submitLabel, defaultDate,
}: {
  action: (data: FormData) => void | Promise<void>; value?: EventFormValue; zone: string; projects: Option[]; clients: Option[];
  employees: EmployeeOption[]; canPublish: boolean; canAssign: boolean; submitLabel: string; defaultDate?: string;
}) {
  const times = initial(value, zone, defaultDate);
  return (
    <form action={action} className="space-y-5">
      {value.id ? <input name="id" type="hidden" value={value.id} /> : null}
      <Field label="Title"><input className={inputClass} defaultValue={value.title} maxLength={160} name="title" required /></Field>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Start date"><input className={inputClass} defaultValue={times.startDate} name="startDate" required type="date" /></Field>
        <Field label="Start time"><input className={inputClass} defaultValue={times.startTime} name="startTime" type="time" /></Field>
        <Field label="End date (optional)"><input className={inputClass} defaultValue={times.endDate} name="endDate" type="date" /></Field>
        <Field label="End time"><input className={inputClass} defaultValue={times.endTime} name="endTime" type="time" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input defaultChecked={value.allDay ?? false} name="allDay" type="checkbox" /> All-day event (times are ignored)</label>
      <p className="text-xs text-[color:var(--muted)]">Times are entered in your time zone ({zone}) and stored in UTC.</p>
      <Field label="Location"><input className={inputClass} defaultValue={value.location ?? ""} maxLength={200} name="location" /></Field>
      <Field label="Description"><textarea className={`${inputClass} min-h-24`} defaultValue={value.description ?? ""} maxLength={4000} name="description" /></Field>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Who can see it">
          <select className={inputClass} defaultValue={value.visibility ?? (canPublish ? "ORGANIZATION" : "PRIVATE")} name="visibility">
            <option value="PRIVATE">Only me and the assignee</option>
            <option value="PROJECT">People on the linked project</option>
            {canPublish ? <option value="ORGANIZATION">Everyone in the organization</option> : null}
          </select>
        </Field>
        <Field label="Project (optional)">
          <select className={inputClass} defaultValue={value.projectId ?? ""} name="projectId">
            <option value="">None</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </Field>
        <Field label="Client (optional)">
          <select className={inputClass} defaultValue={value.clientId ?? ""} name="clientId">
            <option value="">None</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </Field>
        <Field label="Assigned employee (optional)">
          <select className={inputClass} defaultValue={value.assignedEmployeeId ?? ""} name="assignedEmployeeId">
            <option value="">Nobody</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{formatName(employee)}</option>)}
          </select>
          {!canAssign ? <span className="mt-1 block text-xs text-[color:var(--muted)]">You can assign events to yourself.</span> : null}
        </Field>
      </div>
      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}
