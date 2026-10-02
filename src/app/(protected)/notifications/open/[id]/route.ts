import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getOpenTarget } from "@/modules/notifications/service";

export const dynamic = "force-dynamic";

/**
 * Marks the caller's own notification read and redirects to its server-generated link.
 * The destination comes from the stored, allow-listed actionUrl and never from the request;
 * the destination page then applies its normal authorization.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.redirect(new URL("/notifications", request.url));
  const target = await getOpenTarget(user, id);
  return NextResponse.redirect(new URL(target ?? "/notifications", request.url));
}
