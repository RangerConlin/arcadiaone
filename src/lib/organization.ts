import { prisma } from "@/lib/prisma";

export const CURRENT_ORGANIZATION_NAME = "Arcadia Command Solutions";

export async function getCurrentOrganization() {
  return prisma.organization.upsert({
    where: { name: CURRENT_ORGANIZATION_NAME },
    update: {},
    create: { name: CURRENT_ORGANIZATION_NAME },
  });
}
