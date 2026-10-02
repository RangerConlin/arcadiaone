import { createHmac, randomBytes } from "node:crypto";
export const PORTAL_COOKIE = "arcadia_portal_session";
export const PORTAL_SESSION_HOURS = 12;
export const INVITATION_HOURS = 72;
function secret() { const value=process.env.AUTH_SECRET; if ((!value||value.length<32)&&process.env.NODE_ENV==="production") throw new Error("AUTH_SECRET must contain at least 32 characters."); return value||"development-only-auth-secret-change-before-production"; }
export function portalTokenHash(token:string) { return createHmac("sha256",secret()).update(`portal:${token}`).digest("hex"); }
export function createOpaqueToken() { return randomBytes(32).toString("base64url"); }
export function portalScope(user:{organizationId:string;clientId:string}) { return { organizationId:user.organizationId, clientId:user.clientId }; }
export function isPublishableInvoice(status:string) { return ["ISSUED","SENT","PARTIALLY_PAID","PAID","OVERDUE"].includes(status); }
export function safeReturnPath(value:string|null|undefined) { return value?.startsWith("/portal/")&&!value.startsWith("//") ? value : "/portal"; }
