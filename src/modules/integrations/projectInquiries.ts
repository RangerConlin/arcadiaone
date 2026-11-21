import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedApiKey } from "@/lib/apiKeys/keys";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { apiKeyActor, audit } from "@/modules/audit/service";

const optionalText = (max: number) => z.string().trim().max(max).transform((v) => v || undefined).optional();

/** Payload accepted from external integrations (the ACS website contact form, initially). */
export const inquirySchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  email: z.string().trim().min(1, "Email is required.").max(320).email("Enter a valid email address."),
  phone: optionalText(40),
  organization: optionalText(200),
  subject: optionalText(200),
  service: optionalText(200),
  message: z.string().trim().min(1, "Message is required.").max(8000),
  source: optionalText(100),
  submissionId: optionalText(200),
});
export type InquiryInput = z.infer<typeof inquirySchema>;

export class InquiryConflictError extends Error {
  constructor() {
    super("This submission ID was already used with different content.");
  }
}

function buildTitle(input: InquiryInput) {
  return (input.subject || `Website inquiry from ${input.name}`).slice(0, 160);
}

function buildActivityContent(input: InquiryInput, source: string) {
  const lines = [
    `New inquiry received via ${source}.`,
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    input.phone ? `Phone: ${input.phone}` : null,
    input.organization ? `Organization: ${input.organization}` : null,
    input.service ? `Service requested: ${input.service}` : null,
    input.subject ? `Subject: ${input.subject}` : null,
    "Message:",
    input.message,
  ];
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

/** Normalizes the fields that define a submission's identity, so a retried ID with different content is caught. */
function contentHash(input: InquiryInput) {
  const normalized = {
    name: input.name, email: input.email.toLowerCase(), phone: input.phone ?? null, organization: input.organization ?? null,
    subject: input.subject ?? null, service: input.service ?? null, message: input.message,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === "P2002");
}

export type InquiryResult = { status: 201 | 200; duplicate: boolean; project: { id: string; status: string } };

async function existingSubmissionResult(apiKeyId: string, submissionId: string, hash: string): Promise<InquiryResult> {
  const existing = await prisma.projectInquirySubmission.findUnique({ where: { apiKeyId_submissionId: { apiKeyId, submissionId } } });
  if (!existing) throw new Error("Expected a submission record to exist after a duplicate-key conflict.");
  if (existing.contentHash !== hash) throw new InquiryConflictError();
  const project = await prisma.project.findUniqueOrThrow({ where: { id: existing.projectId! } });
  return { status: 200, duplicate: true, project: { id: project.id, status: project.status } };
}

/** Creates an ordinary INQUIRY-status project from a validated external submission. Idempotent on `submissionId`. */
export async function createProjectInquiry(apiKey: AuthenticatedApiKey, input: InquiryInput): Promise<InquiryResult> {
  const hash = contentHash(input);
  const source = apiKey.defaultSource;
  const submissionId = input.submissionId;

  if (submissionId && await prisma.projectInquirySubmission.findUnique({ where: { apiKeyId_submissionId: { apiKeyId: apiKey.id, submissionId } }, select: { id: true } })) {
    return existingSubmissionResult(apiKey.id, submissionId, hash);
  }

  try {
    const project = await prisma.$transaction(async (tx) => {
      if (submissionId) {
        await tx.projectInquirySubmission.create({ data: { organizationId: apiKey.organizationId, apiKeyId: apiKey.id, submissionId, contentHash: hash } });
      }
      const created = await tx.project.create({
        data: {
          organizationId: apiKey.organizationId,
          name: buildTitle(input),
          status: "INQUIRY",
          clientName: input.organization,
          activities: { create: { organizationId: apiKey.organizationId, type: "SYSTEM", content: buildActivityContent(input, source) } },
        },
      });
      if (submissionId) {
        await tx.projectInquirySubmission.update({ where: { apiKeyId_submissionId: { apiKeyId: apiKey.id, submissionId } }, data: { projectId: created.id } });
      }
      await audit.record(tx, {
        organizationId: apiKey.organizationId,
        actor: apiKeyActor(apiKey),
        action: AUDIT_ACTIONS.projectInquiryReceived,
        entityType: "Project",
        entityId: created.id,
        summary: `Inquiry received via ${apiKey.name}: ${created.name}`,
        metadata: { source, submissionId: submissionId ?? null },
      });
      return created;
    });
    return { status: 201, duplicate: false, project: { id: project.id, status: project.status } };
  } catch (error) {
    if (submissionId && isUniqueConstraintError(error)) return existingSubmissionResult(apiKey.id, submissionId, hash);
    throw error;
  }
}
