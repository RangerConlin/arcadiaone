import { Field, inputClass, Notice, SecondaryLink, SubmitButton } from "@/components/ui";

export function DepartmentForm({
  action,
  department,
  error,
}: {
  action: (formData: FormData) => Promise<void>;
  department?: {
    active: boolean;
    description: string | null;
    id: string;
    name: string;
  };
  error?: string;
}) {
  return (
    <form action={action} className="max-w-2xl">
      <Notice message={error} tone="error" />
      {department ? <input name="id" type="hidden" value={department.id} /> : null}
      <div className="grid gap-5 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <Field label="Department name">
          <input
            className={inputClass}
            defaultValue={department?.name ?? ""}
            maxLength={120}
            name="name"
            required
          />
        </Field>
        <Field label="Description">
          <textarea
            className={inputClass}
            defaultValue={department?.description ?? ""}
            maxLength={1000}
            name="description"
            rows={4}
          />
        </Field>
        <label className="flex items-center gap-3 text-sm font-medium">
          <input
            defaultChecked={department?.active ?? true}
            name="active"
            type="checkbox"
          />
          Active
        </label>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <SubmitButton>{department ? "Save department" : "Create department"}</SubmitButton>
        <SecondaryLink href="/administration/departments">Cancel</SecondaryLink>
      </div>
    </form>
  );
}

export function PositionForm({
  action,
  error,
  position,
}: {
  action: (formData: FormData) => Promise<void>;
  error?: string;
  position?: {
    active: boolean;
    description: string | null;
    id: string;
    title: string;
  };
}) {
  return (
    <form action={action} className="max-w-2xl">
      <Notice message={error} tone="error" />
      {position ? <input name="id" type="hidden" value={position.id} /> : null}
      <div className="grid gap-5 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <Field label="Position title">
          <input
            className={inputClass}
            defaultValue={position?.title ?? ""}
            maxLength={120}
            name="title"
            required
          />
        </Field>
        <Field label="Description">
          <textarea
            className={inputClass}
            defaultValue={position?.description ?? ""}
            maxLength={1000}
            name="description"
            rows={4}
          />
        </Field>
        <label className="flex items-center gap-3 text-sm font-medium">
          <input
            defaultChecked={position?.active ?? true}
            name="active"
            type="checkbox"
          />
          Active
        </label>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <SubmitButton>{position ? "Save position" : "Create position"}</SubmitButton>
        <SecondaryLink href="/administration/positions">Cancel</SecondaryLink>
      </div>
    </form>
  );
}
