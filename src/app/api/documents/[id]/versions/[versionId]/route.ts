import { getAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { documentVisibilityWhere } from "@/modules/documents/authorization";
import { documentStorage } from "@/modules/documents/storage";
import { contentDisposition, previewable } from "@/modules/documents/validation";

export async function GET(request:Request,{params}:{params:Promise<{id:string;versionId:string}>}){
  const user=await getAuthenticatedUser();if(!user)return new Response("Authentication required.",{status:401});
  const {id,versionId}=await params;
  const document=await prisma.document.findFirst({where:{id,...documentVisibilityWhere(user)},select:{id:true,versions:{where:{id:versionId},take:1}}});
  const version=document?.versions[0];if(!version)return new Response("Not found.",{status:404});
  if(!await documentStorage.exists(version.storageKey))return new Response("Stored object is unavailable.",{status:410});
  const bytes=await documentStorage.retrieve(version.storageKey),wantInline=new URL(request.url).searchParams.get("preview")==="1"&&previewable(version.mimeType);
  return new Response(Buffer.from(bytes),{headers:{"Content-Type":version.mimeType,"Content-Length":String(version.sizeBytes),"Content-Disposition":contentDisposition(version.originalFilename,wantInline),"X-Content-Type-Options":"nosniff","Cache-Control":"private, no-store","Content-Security-Policy":"default-src 'none'; sandbox"}});
}
