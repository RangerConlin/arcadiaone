import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword, validatePassword } from "../src/lib/auth/password";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || "";
  const employeeId = process.env.BOOTSTRAP_ADMIN_EMPLOYEE_ID || undefined;
  if (!email || !email.includes("@")) throw new Error("BOOTSTRAP_ADMIN_EMAIL must be a valid email.");
  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(`BOOTSTRAP_ADMIN_PASSWORD: ${passwordError}`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    if (await prisma.user.findFirst({ where: { role: "ADMIN" } })) throw new Error("An administrator already exists; refusing to create or overwrite one.");
    const organization = await prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    if (employeeId && !await prisma.employee.findFirst({ where: { id: employeeId, organizationId: organization.id } })) throw new Error("BOOTSTRAP_ADMIN_EMPLOYEE_ID does not belong to the organization.");
    await prisma.user.create({ data: { organizationId: organization.id, employeeId, email, passwordHash: await hashPassword(password), role: "ADMIN", mustChangePassword: true } });
    console.log(`Administrator created for ${email}. Password was not logged and must be changed after first login.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
