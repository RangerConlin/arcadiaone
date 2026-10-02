import { getCurrentOrganization } from "@/lib/organization";
import { prisma } from "@/lib/prisma";

/**
 * Central identity boundary. The hosting authentication layer should set the
 * verified user email; local development gets an organization-scoped admin.
 */
export async function requireCurrentUser() {
  const organization = await getCurrentOrganization();
  const email = process.env.ARCADIA_CURRENT_USER_EMAIL ?? "admin@arcadia.local";

  return prisma.user.upsert({
    where: { organizationId_email: { organizationId: organization.id, email } },
    update: {},
    create: {
      organizationId: organization.id,
      email,
      name: process.env.ARCADIA_CURRENT_USER_NAME ?? "Arcadia Administrator",
      role: "ADMIN",
    },
    include: { employee: true },
  });
}
