import { Field, inputClass, Notice, SecondaryLink, SubmitButton } from "@/components/ui";
import { saveEmployeeQualification, saveQualificationType } from "./actions";

const categories = ["CERTIFICATION", "LICENSE", "QUALIFICATION", "AUTHORIZATION", "INTERNAL"];

export function QualificationTypeForm({ type, error }: { type?: Record<string, unknown>; error?: string }) {
  return <form action={saveQualificationType} className="max-w-3xl">
    <Notice message={error} tone="error" />
    {type?.id ? <input name="id" type="hidden" value={String(type.id)} /> : null}
    <div className="grid gap-5 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5 sm:grid-cols-2">
      <Field label="Name"><input className={inputClass} defaultValue={String(type?.name ?? "")} maxLength={120} name="name" required /></Field>
      <Field label="Abbreviation"><input className={inputClass} defaultValue={String(type?.abbreviation ?? "")} maxLength={20} name="abbreviation" /></Field>
      <Field label="Category"><select className={inputClass} defaultValue={String(type?.category ?? "CERTIFICATION")} name="category">{categories.map((item) => <option key={item} value={item}>{item[0] + item.slice(1).toLowerCase()}</option>)}</select></Field>
      <Field label="Default issuer"><input className={inputClass} defaultValue={String(type?.issuingOrganization ?? "")} name="issuingOrganization" /></Field>
      <Field label="Expiration behavior"><select className={inputClass} defaultValue={String(type?.expirationBehavior ?? "DOES_NOT_EXPIRE")} name="expirationBehavior"><option value="DOES_NOT_EXPIRE">Does not expire</option><option value="TRACKED">Expiration date tracked</option><option value="CALCULATED">Calculated from issue date</option></select></Field>
      <Field label="Default validity (months)"><input className={inputClass} defaultValue={String(type?.defaultValidityMonths ?? "")} max={600} min={1} name="defaultValidityMonths" type="number" /></Field>
      <Field label="Description"><textarea className={inputClass} defaultValue={String(type?.description ?? "")} name="description" rows={3} /></Field>
      <div className="grid content-start gap-3 pt-6 text-sm"><Check name="credentialNumberExpected" label="Credential number expected" checked={Boolean(type?.credentialNumberExpected)} /><Check name="documentExpected" label="Supporting document expected" checked={Boolean(type?.documentExpected)} /><Check name="active" label="Active" checked={type ? Boolean(type.active) : true} /></div>
    </div>
    <div className="mt-5 flex gap-3"><SubmitButton>Save qualification type</SubmitButton><SecondaryLink href="/administration/qualifications">Cancel</SecondaryLink></div>
  </form>;
}

function Check({ checked, label, name }: { checked: boolean; label: string; name: string }) { return <label className="flex items-center gap-2"><input defaultChecked={checked} name={name} type="checkbox" />{label}</label>; }

export function EmployeeQualificationForm({ employeeId, qualification, types, error }: { employeeId: string; qualification?: Record<string, unknown>; types: { id: string; name: string }[]; error?: string }) {
  const date = (key: string) => qualification?.[key] instanceof Date ? (qualification[key] as Date).toISOString().slice(0, 10) : "";
  return <form action={saveEmployeeQualification} className="max-w-3xl">
    <Notice message={error} tone="error" /><input name="employeeId" type="hidden" value={employeeId} />{qualification?.id ? <input name="id" type="hidden" value={String(qualification.id)} /> : null}
    <div className="grid gap-5 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5 sm:grid-cols-2">
      <Field label="Qualification"><select className={inputClass} defaultValue={String(qualification?.qualificationTypeId ?? "")} name="qualificationTypeId" required><option value="">Select a qualification</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></Field>
      <Field label="Credential / license number"><input className={inputClass} defaultValue={String(qualification?.credentialNumber ?? "")} name="credentialNumber" /></Field>
      <Field label="Issuing organization"><input className={inputClass} defaultValue={String(qualification?.issuingOrganization ?? "")} name="issuingOrganization" /></Field>
      <Field label="Issue date"><input className={inputClass} defaultValue={date("issueDate")} name="issueDate" type="date" /></Field>
      <Field label="Expiration date"><input className={inputClass} defaultValue={date("expirationDate")} name="expirationDate" type="date" /></Field>
      <Field label="Notes"><textarea className={inputClass} defaultValue={String(qualification?.notes ?? "")} name="notes" rows={3} /></Field>
    </div><p className="mt-3 text-sm text-[color:var(--muted)]">New and materially edited records are submitted as Unverified. Calculated expiration dates are set automatically.</p>
    <div className="mt-5 flex gap-3"><SubmitButton>Submit qualification</SubmitButton><SecondaryLink href={`/people/${employeeId}`}>Cancel</SecondaryLink></div>
  </form>;
}
