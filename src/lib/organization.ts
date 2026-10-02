import { prisma } from "@/lib/prisma";

const DEFAULT_ORGANIZATION_NAME = "My Organization";

/**
 * The application is currently single-tenant: the current organization is the
 * only organization record. If none exists yet it is created, named from the
 * ORGANIZATION_NAME environment variable.
 */
export async function getCurrentOrganization() {
  const existing = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;

  try {
    return await prisma.organization.create({
      data: { name: process.env.ORGANIZATION_NAME?.trim() || DEFAULT_ORGANIZATION_NAME },
    });
  } catch {
    // A concurrent request created it first (names are unique).
    return prisma.organization.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  }
}
