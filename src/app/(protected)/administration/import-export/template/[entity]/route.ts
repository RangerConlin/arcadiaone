import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { ENTITY_DEFS } from "@/modules/import-export/entities";
import { isImportEntity } from "@/modules/import-export/types";

export const dynamic = "force-dynamic";
const escape = (text: string) => (/[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);

/** Blank import template: headers plus one clearly fictional example row. Contains no real data. */
export async function GET(_request: Request, { params }: { params: Promise<{ entity: string }> }) {
  const user = await getAuthenticatedUser();
  if (!user || user.mustChangePassword) return new NextResponse("Authentication required.", { status: 401 });
  if (user.role !== "ADMIN") return new NextResponse("Forbidden.", { status: 403 });
  const { entity } = await params;
  if (!isImportEntity(entity)) return new NextResponse("Unknown import type.", { status: 404 });
  const def = ENTITY_DEFS[entity];
  const body = [def.fields.map((f) => escape(f.label)).join(","), def.fields.map((f) => escape(f.example)).join(",")].join("\r\n") + "\r\n";
  return new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${entity}-import-template.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
