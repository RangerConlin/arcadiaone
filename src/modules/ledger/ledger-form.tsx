import { Field, SubmitButton, inputClass } from "@/components/ui";

type Option = { id: string; name: string };

export function LedgerForm({ action, categories, clients, projects, rentals, equipment, invoices, today }: {
  action: (data: FormData) => void | Promise<void>; categories: Array<Option & { type: string | null }>; clients: Option[]; projects: Option[];
  rentals: Array<{ id: string; rentalNumber: string }>; equipment: Array<{ id: string; assetNumber: string; name: string }>; invoices: Array<{ id: string; invoiceNumber: string | null }>; today: string;
}) {
  return (
    <form action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Date"><input className={inputClass} defaultValue={today} name="transactionDate" required type="date" /></Field>
        <Field label="Type">
          <select className={inputClass} defaultValue="EXPENSE" name="type">
            <option value="INCOME">Income</option><option value="EXPENSE">Expense</option><option value="ADJUSTMENT">Adjustment (signed)</option>
          </select>
        </Field>
        <Field label="Amount"><input className={inputClass} inputMode="decimal" name="amount" placeholder="0.00" required /></Field>
        <Field label="Reference (optional)"><input className={inputClass} maxLength={120} name="reference" /></Field>
      </div>
      <Field label="Description"><input className={inputClass} maxLength={300} name="description" required /></Field>
      <p className="text-xs text-[color:var(--muted)]">Income and expense amounts are positive. An adjustment may be negative to lower net recorded activity.</p>
      <details className="rounded-sm border border-[color:var(--border)] p-3">
        <summary className="cursor-pointer text-sm font-semibold">Optional links and notes</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Category">
            <select className={inputClass} name="categoryId"><option value="">None</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
          <Field label="Client">
            <select className={inputClass} name="clientId"><option value="">None</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
          <Field label="Project">
            <select className={inputClass} name="projectId"><option value="">None</option>{projects.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
          <Field label="Rental">
            <select className={inputClass} name="rentalId"><option value="">None</option>{rentals.map((c) => <option key={c.id} value={c.id}>{c.rentalNumber}</option>)}</select>
          </Field>
          <Field label="Equipment (expenses only)">
            <select className={inputClass} name="equipmentId"><option value="">None</option>{equipment.map((c) => <option key={c.id} value={c.id}>{c.assetNumber} — {c.name}</option>)}</select>
          </Field>
          <Field label="Invoice">
            <select className={inputClass} name="invoiceId"><option value="">None</option>{invoices.map((c) => <option key={c.id} value={c.id}>{c.invoiceNumber ?? "Draft"}</option>)}</select>
          </Field>
        </div>
        <div className="mt-4"><Field label="Notes"><textarea className={`${inputClass} min-h-20`} maxLength={2000} name="notes" /></Field></div>
      </details>
      <SubmitButton>Record transaction</SubmitButton>
    </form>
  );
}
