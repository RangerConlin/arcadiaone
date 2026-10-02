import { createHash } from "node:crypto";

export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const maxUploadBytes = () => {
  const configured = Number(process.env.DOCUMENT_MAX_UPLOAD_BYTES);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_UPLOAD_BYTES;
};

const extensions: Record<string, string[]> = {
  "application/pdf": ["pdf"], "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"],
  "image/webp": ["webp"], "text/plain": ["txt"], "text/csv": ["csv"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/msword": ["doc"], "application/vnd.ms-excel": ["xls"],
};
const dangerous = new Set(["exe","dll","com","bat","cmd","sh","ps1","php","asp","aspx","jsp","js","mjs","html","htm","svg"]);

export function sanitizeFilename(value: string) {
  const clean = value.replace(/[\r\n\0]/g, "").replace(/\\/g, "/").split("/").pop()?.trim() || "document";
  return clean.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255) || "document";
}
function signatureMatches(mime: string, b: Uint8Array) {
  if (mime === "application/pdf") return Buffer.from(b.subarray(0, 5)).toString() === "%PDF-";
  if (mime === "image/png") return b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47;
  if (mime === "image/jpeg") return b[0]===0xff&&b[1]===0xd8&&b[2]===0xff;
  if (mime === "image/webp") return Buffer.from(b.subarray(0,4)).toString()==="RIFF"&&Buffer.from(b.subarray(8,12)).toString()==="WEBP";
  if (mime.includes("openxmlformats")) return b[0]===0x50&&b[1]===0x4b;
  return true;
}
export function validateUpload(input: { bytes: Uint8Array; filename: string; mimeType: string }) {
  const filename = sanitizeFilename(input.filename);
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  if (!input.bytes.byteLength) throw new Error("The file is empty.");
  if (input.bytes.byteLength > maxUploadBytes()) throw new Error(`The file exceeds the ${Math.floor(maxUploadBytes()/1024/1024)} MB upload limit.`);
  if (dangerous.has(ext) || !extensions[input.mimeType]?.includes(ext)) throw new Error("This file type is not supported.");
  if (!signatureMatches(input.mimeType, input.bytes)) throw new Error("The file contents do not match its declared type.");
  return { filename, mimeType: input.mimeType, checksum: createHash("sha256").update(input.bytes).digest("hex") };
}
export function contentDisposition(filename: string, inline: boolean) {
  const safe = sanitizeFilename(filename).replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(sanitizeFilename(filename)).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`);
  return `${inline ? "inline" : "attachment"}; filename="${safe}"; filename*=UTF-8''${encoded}`;
}
export const previewable = (mime: string) => mime === "application/pdf" || ["image/jpeg","image/png","image/webp"].includes(mime);
