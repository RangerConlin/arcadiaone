import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: databaseUrl,
  }),
});

async function main() {
  const organizationName = process.env.ORGANIZATION_NAME?.trim() || "My Organization";

  const organization =
    (await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } })) ??
    (await prisma.organization.create({
      data: { name: organizationName },
    }));

  if (process.env.SEED_SAMPLE_DATA === "true") {
    const operations = await prisma.department.upsert({
      where: {
        organizationId_name: {
          organizationId: organization.id,
          name: "Operations",
        },
      },
      update: {},
      create: {
        organizationId: organization.id,
        name: "Operations",
        description: "Sample development department.",
      },
    });

    const coordinator = await prisma.position.upsert({
      where: {
        organizationId_title: {
          organizationId: organization.id,
          title: "Operations Coordinator",
        },
      },
      update: {},
      create: {
        organizationId: organization.id,
        title: "Operations Coordinator",
        description: "Sample development position.",
      },
    });

    const employee = await prisma.employee.upsert({
      where: {
        organizationId_employeeNumber: {
          organizationId: organization.id,
          employeeNumber: "DEV-001",
        },
      },
      update: {},
      create: {
        organizationId: organization.id,
        employeeNumber: "DEV-001",
        firstName: "Jordan",
        lastName: "Rivera",
        workEmail: "jordan.rivera@example.com",
        departmentId: operations.id,
        positionId: coordinator.id,
        employmentStatus: "ACTIVE",
      },
    });

    const role = await prisma.projectRole.upsert({
      where: { organizationId_name: { organizationId: organization.id, name: "Coordinator" } },
      update: {},
      create: { organizationId: organization.id, name: "Coordinator", description: "Sample project role." },
    });
    const projectNumber = "OPS-001";
    const project =
      (await prisma.project.findUnique({ where: { organizationId_projectNumber: { organizationId: organization.id, projectNumber } } })) ??
      (await prisma.project.create({
        data: { organizationId: organization.id, projectNumber, name: "Operations Readiness", description: "Sample project for local task workflows.", status: "ACTIVE", projectManagerId: employee.id },
      }));
    await prisma.projectMember.upsert({
      where: { projectId_employeeId: { projectId: project.id, employeeId: employee.id } },
      update: {},
      create: { organizationId: organization.id, projectId: project.id, employeeId: employee.id, projectRoleId: role.id },
    });
    if (!(await prisma.projectMilestone.findFirst({ where: { projectId: project.id, name: "Initial review" } }))) {
      await prisma.projectMilestone.create({ data: { organizationId: organization.id, projectId: project.id, name: "Initial review" } });
    }
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
