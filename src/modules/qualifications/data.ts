import { getCurrentOrganization } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { evaluateRequirements, getQualificationStatus } from "./status";

export async function getQualificationTypes(includeInactive = false) {
  const organization = await getCurrentOrganization();
  return prisma.qualificationType.findMany({
    where: { organizationId: organization.id, ...(includeInactive ? {} : { active: true }) },
    include: { _count: { select: { employeeQualifications: true, positionRequirements: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

export async function getQualificationType(id: string) {
  const organization = await getCurrentOrganization();
  return prisma.qualificationType.findFirst({ where: { id, organizationId: organization.id } });
}

export async function getEmployeeQualifications(employeeId: string) {
  const organization = await getCurrentOrganization();
  const [employee, settings] = await Promise.all([
    prisma.employee.findFirst({
      where: { id: employeeId, organizationId: organization.id },
      include: {
        qualifications: { where: { archivedAt: null }, include: { qualificationType: true, documents: true }, orderBy: { createdAt: "desc" } },
        position: { include: { qualificationRequirements: { include: { qualificationType: true }, orderBy: { qualificationType: { name: "asc" } } } } },
      },
    }),
    prisma.organization.findUnique({ where: { id: organization.id }, select: { qualificationExpirationWarningDays: true } }),
  ]);
  if (!employee) return null;
  const warningDays = settings?.qualificationExpirationWarningDays ?? 60;
  return {
    employee,
    warningDays,
    qualifications: employee.qualifications.map((q) => ({ ...q, status: getQualificationStatus(q.expirationDate, warningDays) })),
    requirements: evaluateRequirements(employee.position?.qualificationRequirements ?? [], employee.qualifications, warningDays),
  };
}

export async function getQualificationsOverview(filters: Record<string, string | undefined> = {}) {
  const organization = await getCurrentOrganization();
  const warningDays = organization.qualificationExpirationWarningDays;
  const employees = await prisma.employee.findMany({
    where: {
      organizationId: organization.id,
      ...(filters.department ? { departmentId: filters.department } : {}),
      ...(filters.position ? { positionId: filters.position } : {}),
      ...(filters.employee ? { OR: [{ firstName: { contains: filters.employee, mode: "insensitive" } }, { lastName: { contains: filters.employee, mode: "insensitive" } }] } : {}),
    },
    include: {
      department: true, position: { include: { qualificationRequirements: { include: { qualificationType: true } } } },
      qualifications: { where: { archivedAt: null, ...(filters.qualification ? { qualificationTypeId: filters.qualification } : {}) }, include: { qualificationType: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  const credentials = employees.flatMap((employee) => employee.qualifications.map((q) => ({ employee, qualification: q, status: getQualificationStatus(q.expirationDate, warningDays) })));
  const requirements = employees.flatMap((employee) => evaluateRequirements(employee.position?.qualificationRequirements ?? [], employee.qualifications, warningDays).filter((r) => r.required).map((r) => ({ employee, requirement: r })));
  return { organization, employees, credentials, requirements };
}
