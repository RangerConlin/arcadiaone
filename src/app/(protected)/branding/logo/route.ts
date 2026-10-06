import { getAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { documentStorage } from "@/modules/documents/storage";

export const dynamic = "force-dynamic";

/** Serves the signed-in user's own organization logo; there is no organization parameter to tamper with. */
export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const org = await prisma.organization.findUnique({ where: { id: user.organizationId }, select: { logoStorageKey: true, logoMimeType: true } });
  if (!org?.logoStorageKey || !org.logoMimeType) return new Response("Not found", { status: 404 });
  const bytes = await documentStorage.retrieve(org.logoStorageKey);
  return new Response(Buffer.from(bytes), { headers: { "Content-Type": org.logoMimeType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
