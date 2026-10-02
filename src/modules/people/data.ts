import type { EmploymentStatus } from "@/generated/prisma/enums";
import { getCurrentOrganization } from "@/lib/organization";
import { prisma } from "@/lib/prisma";

export async function getDashboardStats() {
  const organization = await getCurrentOrganization();
  const [activeEmployees, departments, positions] = await Promise.all([
    prisma.employee.count({
      where: { organizationId: organization.id, employmentStatus: "ACTIVE" },
    }),
    prisma.department.count({
      where: { organizationId: organization.id, active: true },
    }),
    prisma.position.count({
      where: { organizationId: organization.id, active: true },
    }),
  ]);

  return { activeEmployees, departments, positions };
}

export async function listEmployees(filters: {
  departmentId?: string;
  search?: string;
  status?: EmploymentStatus;
}) {
  const organization = await getCurrentOrganization();
  const search = filters.search?.trim();

  return prisma.employee.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    where: {
      organizationId: organization.id,
      departmentId: filters.departmentId || undefined,
      employmentStatus: filters.status || undefined,
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { preferredName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { employeeNumber: { contains: search, mode: "insensitive" } },
              { workEmail: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      department: true,
      position: true,
      supervisor: true,
    },
  });
}

export async function getEmployee(id: string) {
  const organization = await getCurrentOrganization();

  return prisma.employee.findFirst({
    where: { id, organizationId: organization.id },
    include: {
      department: true,
      directReports: {
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      },
      position: true,
      supervisor: true,
      projectMemberships: {
        include: { project: true, projectRole: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function getEmployeeFormOptions(excludeEmployeeId?: string) {
  const organization = await getCurrentOrganization();
  const [departments, positions, supervisors] = await Promise.all([
    prisma.department.findMany({
      orderBy: { name: "asc" },
      where: { organizationId: organization.id, active: true },
    }),
    prisma.position.findMany({
      orderBy: { title: "asc" },
      where: { organizationId: organization.id, active: true },
    }),
    prisma.employee.findMany({
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      where: {
        organizationId: organization.id,
        employmentStatus: { in: ["ACTIVE", "LEAVE"] },
        id: excludeEmployeeId ? { not: excludeEmployeeId } : undefined,
      },
    }),
  ]);

  return { departments, positions, supervisors };
}

export async function listDepartments(includeInactive = true) {
  const organization = await getCurrentOrganization();

  return prisma.department.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    where: {
      organizationId: organization.id,
      active: includeInactive ? undefined : true,
    },
    include: {
      _count: { select: { employees: true } },
    },
  });
}

export async function getDepartment(id: string) {
  const organization = await getCurrentOrganization();

  return prisma.department.findFirst({
    where: { id, organizationId: organization.id },
  });
}

export async function listPositions(includeInactive = true) {
  const organization = await getCurrentOrganization();

  return prisma.position.findMany({
    orderBy: [{ active: "desc" }, { title: "asc" }],
    where: {
      organizationId: organization.id,
      active: includeInactive ? undefined : true,
    },
    include: {
      _count: { select: { employees: true } },
    },
  });
}

export async function getPosition(id: string) {
  const organization = await getCurrentOrganization();

  return prisma.position.findFirst({
    where: { id, organizationId: organization.id },
  });
}
