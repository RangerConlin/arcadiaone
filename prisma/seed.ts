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

    await prisma.employee.upsert({
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
