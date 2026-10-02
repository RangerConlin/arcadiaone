import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Field, inputClass, Notice, SubmitButton } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { saveLedgerCategory, saveLedgerSettings } from "@/modules/ledger/actions";
import { canAdministerLedgerSettings } from "@/modules/ledger/authorization";

export const dynamic = "force-dynamic";

export default async function LedgerCategoriesPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const user = await requireAuthenticatedUser();
  if (!canAdministerLedgerSettings(user)) redirect("/forbidden");
  const [query, categories, organization] = await Promise.all([
    searchParams,
    prisma.ledgerCategory.findMany({ where: { organizationId: user.organizationId }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId }, select: { autoPostPaymentsToLedger: true } }),
  ]);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Ledger", href: "/ledger" }, { label: "Categories" }]} description="Categories are your own labels; none are built in. They never change how totals are calculated." title="Ledger categories" />
      <Notice message={query.success} tone="success" />
      <Notice message={query.error} tone="error" />
      <form action={saveLedgerSettings} className="mb-6 flex max-w-3xl items-center justify-between gap-4 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-4">
        <label className="flex items-center gap-2 text-sm"><input defaultChecked={organization.autoPostPaymentsToLedger} name="autoPost" type="checkbox" /> Post invoice payments to the ledger as income automatically</label>
        <SubmitButton>Save</SubmitButton>
      </form>
      <section className="mb-6 max-w-3xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <h2 className="mb-3 text-base font-semibold">Add category</h2>
        <form action={saveLedgerCategory} className="grid gap-3 sm:grid-cols-4">
          <Field label="Name"><input className={inputClass} maxLength={80} name="name" required /></Field>
          <Field label="Typically used for">
            <select className={inputClass} name="type"><option value="">Anything</option><option value="INCOME">Income</option><option value="EXPENSE">Expense</option><option value="ADJUSTMENT">Adjustment</option></select>
          </Field>
          <Field label="Description"><input className={inputClass} maxLength={200} name="description" /></Field>
          <div className="self-end"><SubmitButton>Add</SubmitButton></div>
        </form>
      </section>
      <div className="grid max-w-3xl gap-2">
        {categories.length === 0 ? <p className="text-sm text-[color:var(--muted)]">No categories yet. Transactions work fine without them.</p> : null}
        {categories.map((c) => (
          <form action={saveLedgerCategory} className="grid items-end gap-2 rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-3 sm:grid-cols-[1fr_9rem_1fr_7rem_auto]" key={c.id}>
            <input name="id" type="hidden" value={c.id} />
            <input aria-label="Name" className={inputClass} defaultValue={c.name} maxLength={80} name="name" required />
            <select aria-label="Type" className={inputClass} defaultValue={c.type ?? ""} name="type"><option value="">Anything</option><option value="INCOME">Income</option><option value="EXPENSE">Expense</option><option value="ADJUSTMENT">Adjustment</option></select>
            <input aria-label="Description" className={inputClass} defaultValue={c.description ?? ""} maxLength={200} name="description" />
            <select aria-label="Status" className={inputClass} defaultValue={String(c.active)} name="active"><option value="true">Active</option><option value="false">Inactive</option></select>
            <SubmitButton>Save</SubmitButton>
          </form>
        ))}
      </div>
    </>
  );
}
