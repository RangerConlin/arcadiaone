import assert from "node:assert/strict";
import test from "node:test";
import { contentDisposition, sanitizeFilename, validateUpload } from "./validation";

test("normalizes untrusted filenames without using their path", () => {
  assert.equal(sanitizeFilename("../../secret/report.pdf\r\nX-Bad: yes"), "report.pdfX-Bad: yes");
  assert.doesNotMatch(contentDisposition("../a\".pdf", false), /[\r\n]/);
});
test("accepts a PDF whose signature, extension, and MIME agree", () => {
  const result=validateUpload({bytes:Buffer.from("%PDF-1.7\n"),filename:"report.pdf",mimeType:"application/pdf"});
  assert.equal(result.filename,"report.pdf");assert.equal(result.checksum.length,64);
});
test("rejects executable extensions and MIME spoofing", () => {
  assert.throws(()=>validateUpload({bytes:Buffer.from("MZ"),filename:"payload.exe",mimeType:"application/pdf"}),/not supported/);
  assert.throws(()=>validateUpload({bytes:Buffer.from("not a pdf"),filename:"fake.pdf",mimeType:"application/pdf"}),/do not match/);
});
test("enforces configured maximum size", () => {
  const old=process.env.DOCUMENT_MAX_UPLOAD_BYTES;process.env.DOCUMENT_MAX_UPLOAD_BYTES="5";
  assert.throws(()=>validateUpload({bytes:Buffer.from("%PDF-long"),filename:"large.pdf",mimeType:"application/pdf"}),/upload limit/);
  if(old===undefined)delete process.env.DOCUMENT_MAX_UPLOAD_BYTES;else process.env.DOCUMENT_MAX_UPLOAD_BYTES=old;
});
