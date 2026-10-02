export const qualificationStatuses = [
  "CURRENT",
  "EXPIRING_SOON",
  "EXPIRED",
  "NO_EXPIRATION",
] as const;

export type QualificationStatus = (typeof qualificationStatuses)[number];
export type RequirementStatus = QualificationStatus | "MISSING" | "UNVERIFIED";

const DAY_MS = 86_400_000;

/** Date-only qualification rules are evaluated at UTC midnight for deterministic results. */
export function getQualificationStatus(
  expirationDate: Date | string | null | undefined,
  warningDays: number,
  now = new Date(),
): QualificationStatus {
  if (!expirationDate) return "NO_EXPIRATION";
  const expires = new Date(expirationDate);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiry = Date.UTC(
    expires.getUTCFullYear(),
    expires.getUTCMonth(),
    expires.getUTCDate(),
  );
  if (expiry < today) return "EXPIRED";
  if (expiry <= today + warningDays * DAY_MS) return "EXPIRING_SOON";
  return "CURRENT";
}

export function calculateExpirationDate(issueDate: Date, validityMonths: number) {
  const result = new Date(issueDate);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + validityMonths);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

type HeldQualification = {
  qualificationTypeId: string;
  expirationDate: Date | string | null;
  verificationStatus: "UNVERIFIED" | "VERIFIED" | "REJECTED";
};

type Requirement = { qualificationTypeId: string; required: boolean };

export function evaluateRequirements<R extends Requirement>(
  requirements: R[],
  held: HeldQualification[],
  warningDays: number,
  now = new Date(),
) {
  return requirements.map((requirement) => {
    const candidates = held.filter(
      (item) => item.qualificationTypeId === requirement.qualificationTypeId,
    );
    if (!candidates.length) return { ...requirement, status: "MISSING" as const };

    const best = candidates
      .map((item) => ({
        item,
        expirationStatus: getQualificationStatus(item.expirationDate, warningDays, now),
      }))
      .sort((a, b) => {
        const rank = { CURRENT: 4, NO_EXPIRATION: 4, EXPIRING_SOON: 3, EXPIRED: 1 };
        return rank[b.expirationStatus] - rank[a.expirationStatus];
      })[0];

    return {
      ...requirement,
      qualification: best.item,
      expirationStatus: best.expirationStatus,
      status:
        best.item.verificationStatus !== "VERIFIED"
          ? ("UNVERIFIED" as const)
          : best.expirationStatus,
    };
  });
}

export const statusLabel: Record<RequirementStatus, string> = {
  CURRENT: "Current",
  EXPIRING_SOON: "Expiring soon",
  EXPIRED: "Expired",
  NO_EXPIRATION: "No expiration",
  MISSING: "Missing",
  UNVERIFIED: "Unverified",
};
