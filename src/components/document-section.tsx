import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { documentVisibilityWhere, canCreateDocuments } from "@/modules/documents/authorization";

export async function DocumentSection({relationType,relationId,returnTo}:{relationType:string;relationId:string;returnTo:string}){
  const user=await requireAuthenticatedUser();
  const docs=await prisma.document.findMany({where:{...documentVisibilityWhere(user),status:"ACTIVE",relations:{some:{[relationType]:relationId}}},include:{currentVersion:true,category:true},orderBy:{updatedAt:"desc"},take:10});
  return <section className="rounded-sm border border-[color:var(--border)] bg-[color:var(--panel)] p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Documents</h2>{canCreateDocuments(user)&&<Link className="text-sm font-semibold text-[color:var(--accent)]" href={`/documents/upload?relationType=${relationType}&relationId=${relationId}&returnTo=${encodeURIComponent(returnTo)}`}>Upload document</Link>}</div>{docs.map(d=><Link className="flex items-center justify-between border-t border-[color:var(--border)] py-3 text-sm" href={`/documents/${d.id}`} key={d.id}><span><strong>{d.title}</strong><span className="ml-2 text-[color:var(--muted)]">{d.currentVersion?.originalFilename}</span></span><span>{d.category?.name||"Uncategorized"}</span></Link>)}{!docs.length&&<p className="text-sm text-[color:var(--muted)]">No documents attached.</p>}</section>
}
