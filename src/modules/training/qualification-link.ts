import type { Prisma } from "@/generated/prisma/client";
import { dateKeyUtc } from "@/lib/datetime";
import { calculateExpirationDate } from "@/modules/qualifications/status";
import { AUDIT_ACTIONS } from "@/modules/audit/actions";
import { audit, type AuditActor } from "@/modules/audit/service";
import type { TrainingPolicy } from "./authorization";

type Tx = Prisma.TransactionClient;

export type QualificationOutcome = {
  /** First qualification created (the one shown as "related"). */
  qualificationId: string | null;
  created: Array<{ id: string; name: string; verified: boolean; downgraded: boolean }>;
  /** Mapped types configured as SUGGEST: nothing was created; staff may do so deliberately. */
  suggested: Array<{ qualificationTypeId: string; name: string }>;
};

/**
 * Applies a course's configured qualification effects after training is completed (or an external
 * record is verified). Conservative by design:
 *   NONE               — nothing.
 *   SUGGEST            — nothing is created; the suggestion is surfaced for a person to act on.
 *   CREATE_UNVERIFIED  — creates an UNVERIFIED qualification that still needs normal verification.
 *   CREATE_VERIFIED    — creates a VERIFIED one only when the organization policy allows it;
 *                        otherwise it falls back to unverified.
 * Idempotent: a type that already has a qualification issued on the same date is skipped.
 */
export async function applyQualificationEffects(
  tx: Tx,
  args: { organizationId: string; employeeId: string; trainingCourseId: string | null; completionDate: Date; policy: TrainingPolicy; actor: AuditActor & { id?: string }; actorUserId: string; courseName: string },
): Promise<QualificationOutcome> {
  const outcome: QualificationOutcome = { qualificationId: null, created: [], suggested: [] };
  if (!args.trainingCourseId) return outcome;
  const links = await tx.trainingCourseQualification.findMany({
    where: { organizationId: args.organizationId, trainingCourseId: args.trainingCourseId, qualificationType: { active: true } },
    include: { qualificationType: true },
  });
  for (const link of links) {
    const type = link.qualificationType;
    if (link.effect === "NONE") continue;
    if (link.effect === "SUGGEST") { outcome.suggested.push({ qualificationTypeId: type.id, name: type.name }); continue; }
    const existing = await tx.employeeQualification.findFirst({
      where: { organizationId: args.organizationId, employeeId: args.employeeId, qualificationTypeId: type.id, archivedAt: null, issueDate: args.completionDate },
      select: { id: true },
    });
    if (existing) { outcome.qualificationId ??= existing.id; continue; }
    const verified = link.effect === "CREATE_VERIFIED" && args.policy.allowVerifiedQualification;
    const downgraded = link.effect === "CREATE_VERIFIED" && !verified;
    const expirationDate =
      type.expirationBehavior === "CALCULATED" && type.defaultValidityMonths ? calculateExpirationDate(args.completionDate, type.defaultValidityMonths) : null;
    const qualification = await tx.employeeQualification.create({
      data: {
        organizationId: args.organizationId, employeeId: args.employeeId, qualificationTypeId: type.id,
        issueDate: args.completionDate, expirationDate, issuingOrganization: type.issuingOrganization,
        verificationStatus: verified ? "VERIFIED" : "UNVERIFIED",
        verifiedAt: verified ? new Date() : null, verifiedByUserId: verified ? args.actorUserId : null,
        verificationNote: `${verified ? "Granted" : "Proposed"} on completion of training course “${args.courseName}” (${dateKeyUtc(args.completionDate)}).`,
        notes: type.expirationBehavior === "TRACKED" ? "Expiration date not set by training; enter it when the credential is confirmed." : null,
      },
    });
    outcome.qualificationId ??= qualification.id;
    outcome.created.push({ id: qualification.id, name: type.name, verified, downgraded });
    await audit.record(tx, {
      organizationId: args.organizationId, actor: args.actor, action: AUDIT_ACTIONS.qualificationAdded, entityType: "EmployeeQualification", entityId: qualification.id,
      summary: `${type.name} ${verified ? "granted" : "proposed (unverified)"} from training “${args.courseName}”`,
      metadata: { employeeId: args.employeeId, source: "training", effect: link.effect, downgradedByPolicy: downgraded },
    });
  }
  return outcome;
}
