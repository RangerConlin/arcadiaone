import { redirect } from "next/navigation";
import { requireAuthenticatedUser, requireRole, type AuthenticatedUser } from "@/lib/auth/session";
export const canViewRentals = () => true;
export const canOperateRentals = (user: AuthenticatedUser) => user.role === "ADMIN" || user.role === "MANAGER" || (user.role === "EMPLOYEE" && Boolean(user.employeeId));
export const canAdminEquipment = (user: AuthenticatedUser) => user.role === "ADMIN";
export const requireRentalManager = () => requireRole("ADMIN","MANAGER");
export const requireEquipmentAdmin = () => requireRole("ADMIN");
export async function requireRentalOperator(){const u=await requireAuthenticatedUser();if(!canOperateRentals(u))redirect("/forbidden");return u;}
