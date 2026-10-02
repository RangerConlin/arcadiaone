import type { AuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { formatName } from "@/lib/format";
import { clientVisibilityWhere } from "@/modules/clients/authorization";
import { projectVisibilityWhere } from "@/modules/projects/authorization";
import type { ReportDefinition } from "./types";

export type FilterOptions = {
  departments: Array<{ id: string; name: string }>;
  positions: Array<{ id: string; name: string }>;
  employees: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  clients: Array<{ id: string; name: string }>;
  qualificationTypes: Array<{ id: string; name: string }>;
};

/** Picker data is loaded only for filters the report uses, and only for records the viewer may see. */
export async function loadFilterOptions(user: AuthenticatedUser, def: ReportDefinition): Promise<FilterOptions> {
  const wants = (key: (typeof def.filters)[number]) => def.filters.includes(key);
  const staff = user.role !== "EMPLOYEE";
  const org = user.organizationId;
  const [departments, positions, employees, projects, clients, qualificationTypes] = await Promise.all([
    wants("department") ? prisma.department.findMany({ where: { organizationId: org, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    wants("position") && staff ? prisma.position.findMany({ where: { organizationId: org, active: true }, select: { id: true, title: true }, orderBy: { title: "asc" } }) : [],
    wants("employee") && staff ? prisma.employee.findMany({ where: { organizationId: org, employmentStatus: { not: "TERMINATED" } }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 500 }) : [],
    wants("project") ? prisma.project.findMany({ where: projectVisibilityWhere(user), select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }) : [],
    wants("client") ? prisma.client.findMany({ where: clientVisibilityWhere(user), select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }) : [],
    wants("qualificationType") && staff ? prisma.qualificationType.findMany({ where: { organizationId: org, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);
  return {
    departments, projects, clients, qualificationTypes,
    positions: positions.map((p) => ({ id: p.id, name: p.title })),
    employees: employees.map((e) => ({ id: e.id, name: formatName(e) })),
  };
}
