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
  const organizationName = "Arcadia Command Solutions";

  const organization =
    (await prisma.organization.findUnique({
      where: { name: organizationName },
    })) ??
    (await prisma.organization.create({
      data: { name: organizationName },
    }));

  const admin = await prisma.user.upsert({
    where: {
      organizationId_email: {
        organizationId: organization.id,
        email: "admin@arcadia.local",
      },
    },
    update: {},
    create: {
      organizationId: organization.id,
      email: "admin@arcadia.local",
      name: "Arcadia Administrator",
      role: "ADMIN",
    },
  });

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

    await prisma.user.update({ where: { id: admin.id }, data: { employeeId: employee.id } });
    const project = await prisma.project.upsert({
      where: { organizationId_name: { organizationId: organization.id, name: "Operations Readiness" } },
      update: {},
      create: { organizationId: organization.id, name: "Operations Readiness", description: "Sample project for local task workflows.", managerUserId: admin.id },
    });
    await prisma.projectMember.upsert({ where: { projectId_employeeId: { projectId: project.id, employeeId: employee.id } }, update: {}, create: { projectId: project.id, employeeId: employee.id, roleName: "Coordinator" } });
    await prisma.projectMilestone.upsert({ where: { projectId_name: { projectId: project.id, name: "Initial review" } }, update: {}, create: { projectId: project.id, name: "Initial review" } });
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
