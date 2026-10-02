"use server";

import { redirect } from "next/navigation";
import { getCurrentOrganization } from "@/lib/organization";
import { prisma } from "@/lib/prisma";
import { canEditEmployee, requireRole } from "@/lib/auth/session";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { diffChanges } from "@/modules/audit/sanitize";
import { audit, userActor } from "@/modules/audit/service";
import {
  departmentSchema,
  employeeSchema,
  flattenError,
  getBoolean,
  getString,
  positionSchema,
} from "@/modules/people/validation";

function errorRedirect(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function employeeFormData(formData: FormData) {
  return {
    employeeNumber: getString(formData, "employeeNumber"),
    firstName: getString(formData, "firstName"),
    preferredName: getString(formData, "preferredName"),
    middleName: getString(formData, "middleName"),
    lastName: getString(formData, "lastName"),
    suffix: getString(formData, "suffix"),
    workEmail: getString(formData, "workEmail"),
    personalEmail: getString(formData, "personalEmail"),
    workPhone: getString(formData, "workPhone"),
    mobilePhone: getString(formData, "mobilePhone"),
    departmentId: getString(formData, "departmentId"),
    positionId: getString(formData, "positionId"),
    supervisorId: getString(formData, "supervisorId"),
    employmentStatus: getString(formData, "employmentStatus"),
    hireDate: getString(formData, "hireDate"),
    separationDate: getString(formData, "separationDate"),
    notes: getString(formData, "notes"),
  };
}

function departmentFormData(formData: FormData) {
  return {
    name: getString(formData, "name"),
    description: getString(formData, "description"),
    active: getBoolean(formData, "active"),
  };
}

function positionFormData(formData: FormData) {
  return {
    title: getString(formData, "title"),
    description: getString(formData, "description"),
    active: getBoolean(formData, "active"),
  };
}

/** Allow-listed audit fields; personal contact details and notes are deliberately excluded. */
const EMPLOYEE_AUDIT_FIELDS = ["employeeNumber", "firstName", "lastName", "departmentId", "positionId", "supervisorId", "employmentStatus", "hireDate", "separationDate", "workEmail"] as const;

export async function createEmployee(formData: FormData) {
  const actor = await requireRole("ADMIN");
  const parsed = employeeSchema.safeParse(employeeFormData(formData));
  if (!parsed.success) {
    errorRedirect("/people/new", flattenError(parsed.error));
  }

  const organization = await getCurrentOrganization();
  let employeeId: string;

  try {
    const employee = await prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({
        data: {
          ...parsed.data,
          organizationId: organization.id,
        },
      });
      await audit.record(tx, {
        organizationId: organization.id, actor: userActor(actor), action: AUDIT_ACTIONS.employeeCreated, entityType: "Employee", entityId: created.id,
        summary: `Employee ${created.firstName} ${created.lastName} created`,
        metadata: { employeeNumber: created.employeeNumber, departmentId: created.departmentId, positionId: created.positionId, employmentStatus: created.employmentStatus },
      });
      return created;
    });
    employeeId = employee.id;
  } catch {
    errorRedirect(
      "/people/new",
      "The employee could not be created. Check for duplicate employee numbers and try again.",
    );
  }

  redirect(`/people/${employeeId}?success=Employee created.`);
}

export async function updateEmployee(formData: FormData) {
  const id = getString(formData, "id");
  const user = await requireRole("ADMIN", "MANAGER");
  if (!(await canEditEmployee(user, id))) redirect("/forbidden");
  const parsed = employeeSchema.safeParse(employeeFormData(formData));
  const failurePath = `/people/${id}/edit`;

  if (!id) {
    errorRedirect("/people", "Employee was not found.");
  }

  if (!parsed.success) {
    errorRedirect(failurePath, flattenError(parsed.error));
  }

  if (parsed.data.supervisorId === id) {
    errorRedirect(failurePath, "An employee cannot supervise themselves.");
  }

  if (parsed.data.supervisorId) {
    const supervisor = await prisma.employee.findUnique({
      where: { id: parsed.data.supervisorId },
      select: { supervisorId: true },
    });

    if (supervisor?.supervisorId === id) {
      errorRedirect(
        failurePath,
        "That supervisor assignment would create a direct reporting cycle.",
      );
    }
  }

  const organization = await getCurrentOrganization();
  const existing = await prisma.employee.findFirst({
    where: { id, organizationId: organization.id },
  });

  if (!existing) {
    errorRedirect("/people", "Employee was not found.");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({ data: parsed.data, where: { id } });
      const changes = diffChanges(existing, updated, EMPLOYEE_AUDIT_FIELDS);
      const base = { organizationId: organization.id, actor: userActor(user), entityType: "Employee" as const, entityId: id };
      const statusChange = changes.find((change) => change.field === "employmentStatus");
      const other = changes.filter((change) => change.field !== "employmentStatus");
      if (statusChange) {
        await audit.record(tx, { ...base, action: AUDIT_ACTIONS.employeeStatusChanged, summary: `Employment status changed from ${statusChange.from} to ${statusChange.to}`, changes: [statusChange] });
      }
      if (other.length) {
        await audit.record(tx, { ...base, action: AUDIT_ACTIONS.employeeUpdated, summary: `Employee ${updated.firstName} ${updated.lastName} updated (${other.map((c) => c.field).join(", ")})`, changes: other });
      }
    });
  } catch {
    errorRedirect(
      failurePath,
      "The employee could not be updated. Check for duplicate employee numbers and try again.",
    );
  }

  redirect(`/people/${id}?success=Employee updated.`);
}

export async function createDepartment(formData: FormData) {
  await requireRole("ADMIN");
  const parsed = departmentSchema.safeParse(departmentFormData(formData));
  if (!parsed.success) {
    errorRedirect("/administration/departments/new", flattenError(parsed.error));
  }

  const organization = await getCurrentOrganization();

  try {
    await prisma.department.create({
      data: { ...parsed.data, organizationId: organization.id },
    });
  } catch {
    errorRedirect(
      "/administration/departments/new",
      "The department could not be created. Check for duplicate names and try again.",
    );
  }

  redirect("/administration/departments?success=Department created.");
}

export async function updateDepartment(formData: FormData) {
  await requireRole("ADMIN");
  const id = getString(formData, "id");
  const parsed = departmentSchema.safeParse(departmentFormData(formData));
  const failurePath = `/administration/departments/${id}/edit`;

  if (!parsed.success) {
    errorRedirect(failurePath, flattenError(parsed.error));
  }

  const organization = await getCurrentOrganization();
  const existing = await prisma.department.findFirst({
    where: { id, organizationId: organization.id },
    select: { id: true },
  });

  if (!existing) {
    errorRedirect("/administration/departments", "Department was not found.");
  }

  try {
    await prisma.department.update({
      data: parsed.data,
      where: { id },
    });
  } catch {
    errorRedirect(
      failurePath,
      "The department could not be updated. Check for duplicate names and try again.",
    );
  }

  redirect("/administration/departments?success=Department updated.");
}

export async function toggleDepartment(formData: FormData) {
  await requireRole("ADMIN");
  const id = getString(formData, "id");
  const active = getString(formData, "active") === "true";
  const organization = await getCurrentOrganization();

  await prisma.department.updateMany({
    data: { active },
    where: { id, organizationId: organization.id },
  });

  redirect("/administration/departments?success=Department status updated.");
}

export async function createPosition(formData: FormData) {
  await requireRole("ADMIN");
  const parsed = positionSchema.safeParse(positionFormData(formData));
  if (!parsed.success) {
    errorRedirect("/administration/positions/new", flattenError(parsed.error));
  }

  const organization = await getCurrentOrganization();

  try {
    await prisma.position.create({
      data: { ...parsed.data, organizationId: organization.id },
    });
  } catch {
    errorRedirect(
      "/administration/positions/new",
      "The position could not be created. Check for duplicate titles and try again.",
    );
  }

  redirect("/administration/positions?success=Position created.");
}

export async function updatePosition(formData: FormData) {
  await requireRole("ADMIN");
  const id = getString(formData, "id");
  const parsed = positionSchema.safeParse(positionFormData(formData));
  const failurePath = `/administration/positions/${id}/edit`;

  if (!parsed.success) {
    errorRedirect(failurePath, flattenError(parsed.error));
  }

  const organization = await getCurrentOrganization();
  const existing = await prisma.position.findFirst({
    where: { id, organizationId: organization.id },
    select: { id: true },
  });

  if (!existing) {
    errorRedirect("/administration/positions", "Position was not found.");
  }

  try {
    await prisma.position.update({
      data: parsed.data,
      where: { id },
    });
  } catch {
    errorRedirect(
      failurePath,
      "The position could not be updated. Check for duplicate titles and try again.",
    );
  }

  redirect("/administration/positions?success=Position updated.");
}

export async function togglePosition(formData: FormData) {
  await requireRole("ADMIN");
  const id = getString(formData, "id");
  const active = getString(formData, "active") === "true";
  const organization = await getCurrentOrganization();

  await prisma.position.updateMany({
    data: { active },
    where: { id, organizationId: organization.id },
  });

  redirect("/administration/positions?success=Position status updated.");
}
