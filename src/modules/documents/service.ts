import "server-only";
import type { AuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { documentStorage } from "./storage";
import { validateUpload } from "./validation";
import { projectVisibilityWhere } from "@/modules/projects/authorization";
import { taskVisibilityWhere } from "@/modules/tasks/authorization";
import { clientVisibilityWhere } from "@/modules/clients/authorization";

export const relationFields = ["employeeId","employeeQualificationId","projectId","taskId","clientId","rentalId","equipmentId"] as const;
export type RelationField = typeof relationFields[number];

export async function validateRelation(organizationId: string, field: RelationField, id: string) {
  const delegate = {
    employeeId: prisma.employee, employeeQualificationId: prisma.employeeQualification,
    projectId: prisma.project, taskId: prisma.task, clientId: prisma.client,
    rentalId: prisma.rental, equipmentId: prisma.equipment,
  }[field] as unknown as { findFirst(args: { where: { id: string; organizationId: string }; select: { id: true } }): Promise<{id:string}|null> };
  if (!await delegate.findFirst({ where: { id, organizationId }, select: { id: true } })) throw new Error("The related record does not exist in this organization.");
}

async function validateRelationAccess(user: AuthenticatedUser, field: RelationField, id: string) {
  if (user.role === "ADMIN") return;
  const allowed = field === "projectId" ? await prisma.project.findFirst({where:{id,...projectVisibilityWhere(user)}})
    : field === "taskId" ? await prisma.task.findFirst({where:{id,...taskVisibilityWhere(user)}})
    : field === "clientId" ? await prisma.client.findFirst({where:{id,...clientVisibilityWhere(user)}})
    : field === "employeeId" ? await prisma.employee.findFirst({where:{id,organizationId:user.organizationId,OR:[{id:user.employeeId||"__none__"},{supervisorId:user.employeeId||"__none__"}]}})
    : field === "employeeQualificationId" ? await prisma.employeeQualification.findFirst({where:{id,organizationId:user.organizationId,employee:{OR:[{id:user.employeeId||"__none__"},{supervisorId:user.employeeId||"__none__"}]}}})
    : field === "rentalId" ? await prisma.rental.findFirst({where:{id,organizationId:user.organizationId}})
    : await prisma.equipment.findFirst({where:{id,organizationId:user.organizationId}});
  if (!allowed) throw new Error("You do not have access to the related record.");
}

export async function createDocument(input: { title:string; description?:string; categoryId?:string; sensitivity?:"NORMAL"|"RESTRICTED"; relationField:RelationField; relationId:string; file:File }, user:AuthenticatedUser) {
  if (input.categoryId && !await prisma.documentCategory.findFirst({where:{id:input.categoryId,organizationId:user.organizationId,active:true}})) throw new Error("Invalid document category.");
  await validateRelation(user.organizationId,input.relationField,input.relationId);
  await validateRelationAccess(user,input.relationField,input.relationId);
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const valid = validateUpload({bytes,filename:input.file.name,mimeType:input.file.type});
  const stored = await documentStorage.store(bytes);
  try {
    return await prisma.$transaction(async tx => {
      const document = await tx.document.create({data:{organizationId:user.organizationId,title:input.title.trim(),description:input.description?.trim()||null,categoryId:input.categoryId||null,sensitivity:input.sensitivity||"NORMAL",createdByUserId:user.id}});
      const version = await tx.documentVersion.create({data:{organizationId:user.organizationId,documentId:document.id,versionNumber:1,originalFilename:valid.filename,storageKey:stored.key,mimeType:valid.mimeType,sizeBytes:stored.sizeBytes,checksum:valid.checksum,uploadedByUserId:user.id}});
      await tx.document.update({where:{id:document.id},data:{currentVersionId:version.id}});
      await tx.documentRelation.create({data:{organizationId:user.organizationId,documentId:document.id,[input.relationField]:input.relationId}});
      await tx.documentActivity.create({data:{organizationId:user.organizationId,documentId:document.id,userId:user.id,type:"UPLOADED",detail:`Version 1 uploaded (${valid.filename}).`}});
      return document;
    });
  } catch (error) { await documentStorage.delete(stored.key); throw error; }
}

export async function addVersion(documentId:string,file:File,notes:string|undefined,user:AuthenticatedUser) {
  const document=await prisma.document.findFirst({where:{id:documentId,organizationId:user.organizationId}});
  if(!document) throw new Error("Document not found.");
  const bytes=new Uint8Array(await file.arrayBuffer()), valid=validateUpload({bytes,filename:file.name,mimeType:file.type}), stored=await documentStorage.store(bytes);
  try{return await prisma.$transaction(async tx=>{
    const latest=await tx.documentVersion.aggregate({where:{documentId},_max:{versionNumber:true}});
    const version=await tx.documentVersion.create({data:{organizationId:user.organizationId,documentId,versionNumber:(latest._max.versionNumber||0)+1,originalFilename:valid.filename,storageKey:stored.key,mimeType:valid.mimeType,sizeBytes:stored.sizeBytes,checksum:valid.checksum,uploadedByUserId:user.id,notes:notes?.trim()||null}});
    await tx.document.update({where:{id:documentId},data:{currentVersionId:version.id}});
    await tx.documentActivity.create({data:{organizationId:user.organizationId,documentId,userId:user.id,type:"VERSION_UPLOADED",detail:`Version ${version.versionNumber} uploaded (${valid.filename}).`}});
    return version;
  });}catch(error){await documentStorage.delete(stored.key);throw error;}
}
