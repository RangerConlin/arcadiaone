import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

export interface ObjectStorage {
  store(bytes: Uint8Array): Promise<{ key: string; sizeBytes: number }>;
  retrieve(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

function safeKey(key: string) {
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid storage key.");
  return key;
}

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly root = process.env.DOCUMENT_STORAGE_PATH || "/data/documents") {}
  private objectPath(key: string) { return path.join(this.root, safeKey(key)); }
  async store(bytes: Uint8Array) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const key = randomUUID();
    const handle = await open(this.objectPath(key), "wx", 0o600);
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
    return { key, sizeBytes: bytes.byteLength };
  }
  async retrieve(key: string) { return readFile(this.objectPath(key)); }
  async delete(key: string) { await rm(this.objectPath(key), { force: true }); }
  async exists(key: string) { try { await stat(this.objectPath(key)); return true; } catch { return false; } }
}

export const documentStorage: ObjectStorage = new LocalObjectStorage();
