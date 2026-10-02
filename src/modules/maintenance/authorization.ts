import type { AuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

type Actor = Pick<AuthenticatedUser, "id" | "organizationId" | "employeeId" | "role">;

export type MaintenancePolicy = { managersCanManage: boolean; employeesCanReport: boolean; autoPostCost: boolean; dueSoonDays: number; meterWarningPercent: number };

export async function getMaintenancePolicy(organizationId: string): Promise<MaintenancePolicy> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { managersCanManageMaintenance: true, employeesCanReportMaintenance: true, autoPostMaintenanceCostToLedger: true, maintenanceDueSoonDays: true, maintenanceMeterWarningPercent: true },
  });
  return { managersCanManage: org.managersCanManageMaintenance, employeesCanReport: org.employeesCanReportMaintenance, autoPostCost: org.autoPostMaintenanceCostToLedger, dueSoonDays: org.maintenanceDueSoonDays, meterWarningPercent: org.maintenanceMeterWarningPercent };
}

/**
 * Centralized maintenance permissions.
 *  ADMIN    — everything.
 *  MANAGER  — manages maintenance when the organization allows it (default on).
 *  EMPLOYEE — views equipment maintenance (like equipment itself) without costs, may report an
 *             issue when allowed, and can never change status, complete or close a record.
 */
export const canViewMaintenance = (user: Actor) => Boolean(user.id);
export const canManageMaintenance = (user: Actor, policy: MaintenancePolicy) => user.role === "ADMIN" || (user.role === "MANAGER" && policy.managersCanManage);
export const canReportIssue = (user: Actor, policy: MaintenancePolicy) => canManageMaintenance(user, policy) || (policy.employeesCanReport && Boolean(user.employeeId));
export const canSeeMaintenanceCost = (user: Actor) => user.role === "ADMIN" || user.role === "MANAGER";
export const canPostCostToLedger = (user: Actor) => user.role === "ADMIN";
