import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedUser } from "@/lib/auth/session";

type Actor = Pick<AuthenticatedUser, "id" | "organizationId" | "employeeId" | "role">;

/**
 * Centralized financial permissions.
 *
 *  - ADMIN: full ledger access (view, create, void, categories, settings).
 *  - MANAGER: read-only, and only transactions tied to records they already control under the
 *    existing financial design (invoices they created or whose project they manage, projects
 *    they manage, or transactions they created). They may record a transaction only against a
 *    project they manage.
 *  - EMPLOYEE: no ledger access of any kind.
 */
export const canAccessLedger = (user: Actor) => user.role === "ADMIN" || user.role === "MANAGER";
export const canManageLedger = (user: Actor) => user.role === "ADMIN";
export const canAdministerLedgerSettings = (user: Actor) => user.role === "ADMIN";
export const canVoidLedgerTransaction = (user: Actor) => user.role === "ADMIN";

/** Managers may create only project-linked entries for projects they manage. */
export const canCreateLedgerTransaction = (user: Actor, project?: { projectManagerId: string | null } | null) => {
  if (user.role === "ADMIN") return true;
  return user.role === "MANAGER" && Boolean(project && user.employeeId && project.projectManagerId === user.employeeId);
};

/** Row-level scope applied to every ledger query, list, summary and report. Always organization-bound. */
export function ledgerVisibilityWhere(user: Actor): Prisma.LedgerTransactionWhereInput {
  if (user.role === "ADMIN") return { organizationId: user.organizationId };
  if (user.role === "MANAGER") {
    const employeeId = user.employeeId ?? "__none__";
    return {
      organizationId: user.organizationId,
      OR: [
        { createdByUserId: user.id },
        { project: { projectManagerId: employeeId } },
        { invoice: { OR: [{ createdByUserId: user.id }, { project: { projectManagerId: employeeId } }] } },
      ],
    };
  }
  return { organizationId: "__denied__" };
}
