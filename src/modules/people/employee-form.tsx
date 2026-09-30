import type { EmploymentStatus } from "@/generated/prisma/enums";
import { EmploymentStatus as EmploymentStatusValues } from "@/generated/prisma/enums";
import { Field, inputClass, Notice, SecondaryLink, SubmitButton } from "@/components/ui";
import { formatName } from "@/lib/format";

type EmployeeOption = {
  id: string;
  firstName: string;
  preferredName: string | null;
  lastName: string;
  suffix?: string | null;
};

type EmployeeFormValue = {
  id?: string;
  employeeNumber?: string | null;
  firstName?: string | null;
  preferredName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  suffix?: string | null;
  workEmail?: string | null;
  personalEmail?: string | null;
  workPhone?: string | null;
  mobilePhone?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  supervisorId?: string | null;
  employmentStatus?: EmploymentStatus;
  hireDate?: Date | null;
  separationDate?: Date | null;
  notes?: string | null;
};

function dateValue(date?: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

export function EmployeeForm({
  action,
  cancelHref,
  employee,
  error,
  options,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  cancelHref: string;
  employee?: EmployeeFormValue;
  error?: string;
  options: {
    departments: Array<{ id: string; name: string }>;
    positions: Array<{ id: string; title: string }>;
    supervisors: EmployeeOption[];
  };
  submitLabel: string;
}) {
  return (
    <form action={action} className="max-w-5xl">
      <Notice message={error} tone="error" />
      {employee?.id ? <input name="id" type="hidden" value={employee.id} /> : null}

      <div className="grid gap-5 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5 md:grid-cols-2">
        <Field label="Employee #">
          <input
            className={inputClass}
            defaultValue={employee?.employeeNumber ?? ""}
            maxLength={50}
            name="employeeNumber"
          />
        </Field>
        <Field label="Employment status">
          <select
            className={inputClass}
            defaultValue={employee?.employmentStatus ?? "ACTIVE"}
            name="employmentStatus"
          >
            {Object.values(EmploymentStatusValues).map((status) => (
              <option key={status} value={status}>
                {status.toLowerCase()}
              </option>
            ))}
          </select>
        </Field>
        <Field label="First name">
          <input
            className={inputClass}
            defaultValue={employee?.firstName ?? ""}
            maxLength={100}
            name="firstName"
            required
          />
        </Field>
        <Field label="Preferred name">
          <input
            className={inputClass}
            defaultValue={employee?.preferredName ?? ""}
            maxLength={100}
            name="preferredName"
          />
        </Field>
        <Field label="Middle name">
          <input
            className={inputClass}
            defaultValue={employee?.middleName ?? ""}
            maxLength={100}
            name="middleName"
          />
        </Field>
        <Field label="Last name">
          <input
            className={inputClass}
            defaultValue={employee?.lastName ?? ""}
            maxLength={100}
            name="lastName"
            required
          />
        </Field>
        <Field label="Suffix">
          <input
            className={inputClass}
            defaultValue={employee?.suffix ?? ""}
            maxLength={30}
            name="suffix"
          />
        </Field>
        <Field label="Department">
          <select
            className={inputClass}
            defaultValue={employee?.departmentId ?? ""}
            name="departmentId"
          >
            <option value="">None</option>
            {options.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Position">
          <select
            className={inputClass}
            defaultValue={employee?.positionId ?? ""}
            name="positionId"
          >
            <option value="">None</option>
            {options.positions.map((position) => (
              <option key={position.id} value={position.id}>
                {position.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Supervisor">
          <select
            className={inputClass}
            defaultValue={employee?.supervisorId ?? ""}
            name="supervisorId"
          >
            <option value="">None</option>
            {options.supervisors.map((supervisor) => (
              <option key={supervisor.id} value={supervisor.id}>
                {formatName(supervisor)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Work email">
          <input
            className={inputClass}
            defaultValue={employee?.workEmail ?? ""}
            maxLength={254}
            name="workEmail"
            type="email"
          />
        </Field>
        <Field label="Personal email">
          <input
            className={inputClass}
            defaultValue={employee?.personalEmail ?? ""}
            maxLength={254}
            name="personalEmail"
            type="email"
          />
        </Field>
        <Field label="Work phone">
          <input
            className={inputClass}
            defaultValue={employee?.workPhone ?? ""}
            maxLength={40}
            name="workPhone"
          />
        </Field>
        <Field label="Mobile phone">
          <input
            className={inputClass}
            defaultValue={employee?.mobilePhone ?? ""}
            maxLength={40}
            name="mobilePhone"
          />
        </Field>
        <Field label="Hire date">
          <input
            className={inputClass}
            defaultValue={dateValue(employee?.hireDate)}
            name="hireDate"
            type="date"
          />
        </Field>
        <Field label="Separation date">
          <input
            className={inputClass}
            defaultValue={dateValue(employee?.separationDate)}
            name="separationDate"
            type="date"
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Notes">
            <textarea
              className={inputClass}
              defaultValue={employee?.notes ?? ""}
              maxLength={4000}
              name="notes"
              rows={5}
            />
          </Field>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <SubmitButton>{submitLabel}</SubmitButton>
        <SecondaryLink href={cancelHref}>Cancel</SecondaryLink>
      </div>
    </form>
  );
}
