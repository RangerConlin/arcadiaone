import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { normalizeQuery, searchSuggestions } from "@/modules/search/service";

export const dynamic = "force-dynamic";

/** Header dropdown data: at most three hits per entity, always filtered by the viewer's own permissions. */
export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = normalizeQuery(new URL(request.url).searchParams.get("q"));
  const groups = await searchSuggestions(user, q, 3);
  return NextResponse.json({ groups }, { headers: { "Cache-Control": "private, no-store" } });
}
