import { z } from "zod";
const optional = z.string().trim().max(500).transform(v => v || undefined);
export const clientSchema = z.object({
  name: z.string().trim().min(1).max(160), displayName: optional, clientNumber: optional,
  status: z.enum(["PROSPECT","ACTIVE","INACTIVE","ARCHIVED"]),
  type: z.enum(["BUSINESS","GOVERNMENT","NONPROFIT","INDIVIDUAL","OTHER"]).optional(),
  website: optional, mainPhone: optional, generalEmail: z.union([z.literal(""),z.email()]).transform(v=>v||undefined),
  addressLine1: optional,addressLine2:optional,city:optional,stateProvince:optional,postalCode:optional,country:optional,
  notes: z.string().trim().max(5000).transform(v=>v||undefined),
});
export const contactSchema=z.object({firstName:z.string().trim().min(1).max(100),lastName:z.string().trim().min(1).max(100),title:optional,email:z.union([z.literal(""),z.email()]).transform(v=>v||undefined),phone:optional,mobilePhone:optional,preferredContactMethod:z.enum(["EMAIL","PHONE","MOBILE"]).optional(),primary:z.boolean(),active:z.boolean(),notes:z.string().trim().max(2000).transform(v=>v||undefined)});
export const activitySchema=z.object({activityType:z.enum(["PHONE_CALL","EMAIL","MEETING","NOTE","OTHER"]),summary:z.string().trim().min(1).max(3000),occurredAt:z.coerce.date()});
export const val=(f:FormData,k:string)=>String(f.get(k)||"").trim();
export const fields=(f:FormData)=>({name:val(f,"name"),displayName:val(f,"displayName"),clientNumber:val(f,"clientNumber"),status:val(f,"status"),type:val(f,"type")||undefined,website:val(f,"website"),mainPhone:val(f,"mainPhone"),generalEmail:val(f,"generalEmail"),addressLine1:val(f,"addressLine1"),addressLine2:val(f,"addressLine2"),city:val(f,"city"),stateProvince:val(f,"stateProvince"),postalCode:val(f,"postalCode"),country:val(f,"country"),notes:val(f,"notes")});
