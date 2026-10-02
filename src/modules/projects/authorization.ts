export type ApplicationRole = "ADMIN" | "MANAGER" | "EMPLOYEE";
export function getCurrentAccess() { return { role: (process.env.ARCADIA_ROLE || "ADMIN") as ApplicationRole, employeeId: process.env.ARCADIA_EMPLOYEE_ID }; }
export function requireAdmin() { if (getCurrentAccess().role !== "ADMIN") throw new Error("Not authorized"); }
export function requireCreateProject() { if (getCurrentAccess().role === "EMPLOYEE") throw new Error("Not authorized"); }
export function requireProjectManagement(project: { projectManagerId: string | null }) { const a = getCurrentAccess(); if (a.role === "ADMIN") return; if (a.role !== "MANAGER" || !a.employeeId || a.employeeId !== project.projectManagerId) throw new Error("Not authorized"); }
