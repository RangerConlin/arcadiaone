/**
 * Storage boundary for qualification evidence. Implementations own binary data;
 * qualification business services only persist the returned opaque key and metadata.
 * No implementation is registered until authenticated upload/download routes exist.
 */
export type QualificationFile = {
  bytes: Uint8Array;
  mimeType: string;
  originalFilename: string;
};

export type StoredQualificationFile = {
  storageKey: string;
  sizeBytes: number;
};

export interface QualificationDocumentStorage {
  put(file: QualificationFile): Promise<StoredQualificationFile>;
  read(storageKey: string): Promise<Uint8Array>;
  remove(storageKey: string): Promise<void>;
}

export const qualificationDocumentRules = {
  maxBytes: 10 * 1024 * 1024,
  allowedMimeTypes: new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
  ]),
};

export function validateQualificationFile(file: QualificationFile) {
  if (!qualificationDocumentRules.allowedMimeTypes.has(file.mimeType)) {
    throw new Error("Only PDF, JPEG, PNG, and WebP credential documents are accepted.");
  }
  if (!file.bytes.byteLength || file.bytes.byteLength > qualificationDocumentRules.maxBytes) {
    throw new Error("Credential documents must be no larger than 10 MB.");
  }
}
