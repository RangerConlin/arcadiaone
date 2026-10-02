import type { ClientStatus, ClientType, Prisma } from "@/generated/prisma/client";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { clientVisibilityWhere } from "./authorization";

export async function listClients(q: Record<string, string | undefined>) {
  const user = await requireAuthenticatedUser();
  const search = q.search?.trim();
  const searchWhere: Prisma.ClientWhereInput = search ? { OR: [
    { name: { contains: search, mode: "insensitive" } }, { displayName: { contains: search, mode: "insensitive" } },
    { clientNumber: { contains: search, mode: "insensitive" } }, { generalEmail: { contains: search, mode: "insensitive" } },
    { mainPhone: { contains: search, mode: "insensitive" } },
    { contacts: { some: { OR: [
      { firstName: { contains: search, mode: "insensitive" } }, { lastName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } }, { phone: { contains: search, mode: "insensitive" } },
    ] } } },
  ] } : {};
  return prisma.client.findMany({
    where: { AND: [clientVisibilityWhere(user), q.status ? { status: q.status as ClientStatus } : {}, q.type ? { type: q.type as ClientType } : {}, searchWhere] },
    include: { primaryContact: true, projects: { where: { status: "ACTIVE" }, select: { id: true } }, activities: { take: 1, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } } },
    orderBy: { name: "asc" },
  });
}
export async function getClient(id: string) {
  const user = await requireAuthenticatedUser();
  return prisma.client.findFirst({ where: { AND: [{ id }, clientVisibilityWhere(user)] }, include: {
    contacts: { orderBy: [{ primary: "desc" }, { lastName: "asc" }] }, projects: { orderBy: { updatedAt: "desc" } },
    activities: { orderBy: { occurredAt: "desc" }, include: { user: { select: { email: true, employee: { select: { firstName: true, lastName: true, preferredName: true } } } } } }, primaryContact: true,
  } });
}
