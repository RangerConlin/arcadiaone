import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Notice } from "@/components/ui";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { todayKey } from "@/lib/datetime";
import { prisma } from "@/lib/prisma";
import { clientVisibilityWhere } from "@/modules/clients/authorization";
import { invoiceVisibilityWhere } from "@/modules/invoices/authorization";
import { getViewerTimeZone } from "@/modules/calendar/service";
import { createLedgerEntry } from "@/modules/ledger/actions";
import { canAccessLedger } from "@/modules/ledger/authorization";
import { LedgerForm } from "@/modules/ledger/ledger-form";
import { projectVisibilityWhere } from "@/modules/projects/authorization";

export const dynamic = "force-dynamic";

export default async function NewLedgerEntryPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireAuthenticatedUser();
  if (!canAccessLedger(user)) redirect("/forbidden");
  const [query, zone] = await Promise.all([searchParams, getViewerTimeZone(user)]);
  const admin = user.role === "ADMIN";
  const [categories, clients, projects, rentals, equipment, invoices] = await Promise.all([
    prisma.ledgerCategory.findMany({ where: { organizationId: user.organizationId, active: true }, select: { id: true, name: true, type: true }, orderBy: { name: "asc" } }),
    prisma.client.findMany({ where: clientVisibilityWhere(user), select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
    prisma.project.findMany({ where: { AND: [projectVisibilityWhere(user), admin ? {} : { projectManagerId: user.employeeId ?? "__none__" }] }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
    prisma.rental.findMany({ where: { organizationId: user.organizationId }, select: { id: true, rentalNumber: true }, orderBy: { reservationStart: "desc" }, take: 200 }),
    prisma.equipment.findMany({ where: { organizationId: user.organizationId, active: true }, select: { id: true, assetNumber: true, name: true }, orderBy: { assetNumber: "asc" }, take: 500 }),
    prisma.invoice.findMany({ where: { ...invoiceVisibilityWhere(user), status: { not: "DRAFT" } }, select: { id: true, invoiceNumber: true }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Ledger", href: "/ledger" }, { label: "New transaction" }]} description={admin ? "Only date, type, description and amount are required." : "As a manager you can record a transaction against a project you manage."} title="New transaction" />
      <Notice message={query.error} tone="error" />
      <section className="max-w-4xl rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5">
        <LedgerForm action={createLedgerEntry} categories={categories} clients={clients} equipment={equipment} invoices={invoices} projects={projects} rentals={rentals} today={todayKey(zone)} />
      </section>
    </>
  );
}
