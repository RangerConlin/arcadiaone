import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { ApiKeyPermission } from "@/generated/prisma/enums";

const KEY_PREFIX = "ao_live_";

function secret() {
  const value = process.env.AUTH_SECRET;
  if ((!value || value.length < 32) && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must contain at least 32 characters in production.");
  }
  return value || "development-only-auth-secret-change-before-production";
}

export function hashApiKey(key: string) {
  return createHmac("sha256", secret()).update(key).digest("hex");
}

/** Generates a new plaintext API key. Only the caller sees this value; only its hash is persisted. */
export function generateApiKey() {
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, KEY_PREFIX.length + 8) };
}

export type AuthenticatedApiKey = {
  id: string;
  organizationId: string;
  name: string;
  permissions: ApiKeyPermission[];
  defaultSource: string;
};

function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match ? match[1].trim() : null;
}

/** Authenticates a request's `Authorization: Bearer <key>` header against stored key hashes. */
export async function authenticateApiKey(authorizationHeader: string | null): Promise<AuthenticatedApiKey | null> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) return null;
  const hash = hashApiKey(token);
  const record = await prisma.apiKey.findUnique({ where: { keyHash: hash } });
  if (!record || record.revokedAt) return null;
  // The lookup above is already an exact hash match; this guards against any future comparison refactor.
  if (!timingSafeEqual(Buffer.from(hash), Buffer.from(record.keyHash))) return null;
  await prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return { id: record.id, organizationId: record.organizationId, name: record.name, permissions: record.permissions, defaultSource: record.defaultSource };
}

export function hasPermission(apiKey: AuthenticatedApiKey, permission: ApiKeyPermission) {
  return apiKey.permissions.includes(permission);
}
