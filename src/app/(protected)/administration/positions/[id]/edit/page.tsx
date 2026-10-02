import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { updatePosition } from "@/modules/people/actions";
import { getPosition } from "@/modules/people/data";
import { PositionForm } from "@/modules/people/admin-forms";
import { inputClass, Notice, SubmitButton } from "@/components/ui";
import { getQualificationTypes } from "@/modules/qualifications/data";
import { removePositionRequirement, savePositionRequirement } from "@/modules/qualifications/actions";

export const dynamic = "force-dynamic";

export default async function EditPositionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const [position, types] = await Promise.all([getPosition(id), getQualificationTypes()]);

  if (!position) {
    notFound();
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Administration", href: "/administration" },
          { label: "Positions", href: "/administration/positions" },
          { label: "Edit" },
        ]}
        title="Edit Position"
      />
      <PositionForm action={updatePosition} error={query.error} position={position} />
      <section className="mt-8 max-w-3xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5"><h2 className="text-base font-semibold">Qualification Requirements</h2><p className="mt-1 text-sm text-[color:var(--muted)]">Define required or preferred credentials for employees in this position.</p><Notice message={query.success} tone="success" />
      <form action={savePositionRequirement} className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_2fr_auto]"><input name="positionId" type="hidden" value={id}/><select className={inputClass} name="qualificationTypeId" required><option value="">Select qualification</option>{types.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select><select className={inputClass} name="required"><option value="true">Required</option><option value="false">Preferred</option></select><input className={inputClass} name="notes" placeholder="Notes (optional)"/><SubmitButton>Add</SubmitButton></form>
      <div className="mt-4 grid gap-2">{position.qualificationRequirements.map(r=><div className="flex items-center justify-between rounded-sm border border-[color:var(--border)] p-3 text-sm" key={r.id}><span><strong>{r.qualificationType.name}</strong> · {r.required?"Required":"Preferred"}{r.notes?` — ${r.notes}`:""}</span><form action={removePositionRequirement}><input name="id" type="hidden" value={r.id}/><input name="positionId" type="hidden" value={id}/><button className="underline">Remove</button></form></div>)}{!position.qualificationRequirements.length&&<p className="text-sm text-[color:var(--muted)]">No qualification requirements defined.</p>}</div></section>
    </>
  );
}
