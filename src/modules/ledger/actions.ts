"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { clientVisibilityWhere } from "@/modules/clients/authorization";
import { invoiceVisibilityWhere } from "@/modules/invoices/authorization";
import { projectVisibilityWhere } from "@/modules/projects/authorization";
import { canAccessLedger, canAdministerLedgerSettings, canCreateLedgerTransaction, canVoidLedgerTransaction, ledgerVisibilityWhere } from "./authorization";
import { createLedgerTransaction, voidLedgerTransaction } from "./service";
import { transactionInput, transactionSchema } from "./validation";

const fail = (path: string, message: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(message)}`);
const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

async function requireLedgerUser() {
  const user = await requireAuthenticatedUser();
  if (!canAccessLedger(user)) redirect("/forbidden");
  return user;
}

/** Every linked record must belong to the actor's organization and be visible to them. */
async function resolveLinks(user: AuthenticatedUser, data: Exclude<ReturnType<typeof transactionSchema.parse>, never>, failPath: string) {
  const org = user.organizationId;
  const [project, client, rental, invoice, equipment, category] = await Promise.all([
    data.projectId ? prisma.project.findFirst({ where: { id: data.projectId, ...projectVisibilityWhere(user) }, select: { id: true, clientId: true, projectManagerId: true } }) : null,
    data.clientId ? prisma.client.findFirst({ where: { id: data.clientId, ...clientVisibilityWhere(user) }, select: { id: true } }) : null,
    data.rentalId ? prisma.rental.findFirst({ where: { id: data.rentalId, organizationId: org }, select: { id: true, clientId: true, projectId: true } }) : null,
    data.invoiceId ? prisma.invoice.findFirst({ where: { id: data.invoiceId, ...invoiceVisibilityWhere(user) }, select: { id: true, clientId: true, projectId: true, rentalId: true, currency: true } }) : null,
    data.equipmentId ? prisma.equipment.findFirst({ where: { id: data.equipmentId, organizationId: org }, select: { id: true } }) : null,
    data.categoryId ? prisma.ledgerCategory.findFirst({ where: { id: data.categoryId, organizationId: org, active: true }, select: { id: true } }) : null,
  ]);
  if (data.projectId && !project) fail(failPath, "That project was not found or you cannot access it.");
  if (data.clientId && !client) fail(failPath, "That client was not found or you cannot access it.");
  if (data.rentalId && !rental) fail(failPath, "That rental was not found.");
  if (data.invoiceId && !invoice) fail(failPath, "That invoice was not found or you cannot access it.");
  if (data.equipmentId && !equipment) fail(failPath, "That equipment was not found.");
  if (data.categoryId && !category) fail(failPath, "That category is not available.");
  if (!canCreateLedgerTransaction(user, project)) {
    fail(failPath, user.role === "MANAGER" ? "Managers can record transactions only against a project they manage." : "You are not allowed to record ledger transactions.");
  }
  return {
    clientId: data.clientId ?? invoice?.clientId ?? rental?.clientId ?? project?.clientId ?? null,
    projectId: data.projectId ?? invoice?.projectId ?? rental?.projectId ?? null,
    rentalId: data.rentalId ?? invoice?.rentalId ?? null,
    currency: invoice?.currency,
  };
}

export async function createLedgerEntry(form: FormData) {
  const user = await requireLedgerUser();
  const parsed = transactionSchema.safeParse(transactionInput(form));
  if (!parsed.success) return fail("/ledger/new", parsed.error.issues[0]?.message ?? "Invalid transaction.");
  const data = parsed.data;
  const links = await resolveLinks(user, data, "/ledger/new");
  const row = await prisma.$transaction((tx) =>
    createLedgerTransaction(tx, user.organizationId, user, user.id, { ...data, ...links }),
  );
  redirect(`/ledger/${row.id}?success=Transaction recorded.`);
}

export async function voidLedgerEntry(form: FormData) {
  const user = await requireAuthenticatedUser();
  if (!canVoidLedgerTransaction(user)) redirect("/forbidden");
  const id = text(form, "id");
  const parsed = z.string().trim().min(3, "Enter a reason of at least 3 characters.").max(500).safeParse(text(form, "reason"));
  if (!parsed.success) return fail(`/ledger/${id}`, parsed.error.issues[0]?.message ?? "A reason is required.");
  const visible = await prisma.ledgerTransaction.findFirst({ where: { id, ...ledgerVisibilityWhere(user) }, select: { id: true } });
  if (!visible) return fail("/ledger", "Transaction not found.");
  try {
    await prisma.$transaction((tx) => voidLedgerTransaction(tx, user.organizationId, user, id, parsed.data));
  } catch (error) {
    return fail(`/ledger/${id}`, error instanceof Error ? error.message : "The transaction could not be voided.");
  }
  redirect(`/ledger/${id}?success=Transaction voided. The original record is preserved.`);
}

export async function saveLedgerCategory(form: FormData) {
  const user = await requireAuthenticatedUser();
  if (!canAdministerLedgerSettings(user)) redirect("/forbidden");
  const id = text(form, "id"), name = text(form, "name").slice(0, 80);
  const type = ["INCOME", "EXPENSE", "ADJUSTMENT"].includes(text(form, "type")) ? (text(form, "type") as "INCOME" | "EXPENSE" | "ADJUSTMENT") : null;
  if (!name) return fail("/ledger/categories", "Category name is required.");
  try {
    if (id) {
      const result = await prisma.ledgerCategory.updateMany({ where: { id, organizationId: user.organizationId }, data: { name, type, description: text(form, "description") || null, active: text(form, "active") !== "false" } });
      if (!result.count) return fail("/ledger/categories", "Category not found.");
    } else {
      await prisma.ledgerCategory.create({ data: { organizationId: user.organizationId, name, type, description: text(form, "description") || null } });
    }
  } catch {
    return fail("/ledger/categories", "Category names must be unique.");
  }
  redirect("/ledger/categories?success=Category saved.");
}

export async function saveLedgerSettings(form: FormData) {
  const user = await requireAuthenticatedUser();
  if (!canAdministerLedgerSettings(user)) redirect("/forbidden");
  await prisma.organization.update({ where: { id: user.organizationId }, data: { autoPostPaymentsToLedger: form.get("autoPost") === "on" } });
  revalidatePath("/ledger/categories");
  redirect("/ledger/categories?success=Settings saved.");
}
