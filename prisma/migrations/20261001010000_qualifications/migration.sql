CREATE TYPE "QualificationCategory" AS ENUM ('CERTIFICATION', 'LICENSE', 'QUALIFICATION', 'AUTHORIZATION', 'INTERNAL');
CREATE TYPE "ExpirationBehavior" AS ENUM ('DOES_NOT_EXPIRE', 'TRACKED', 'CALCULATED');
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');

ALTER TABLE "Organization" ADD COLUMN "qualificationExpirationWarningDays" INTEGER NOT NULL DEFAULT 60;

CREATE TABLE "QualificationType" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "abbreviation" TEXT, "description" TEXT, "category" "QualificationCategory" NOT NULL,
  "issuingOrganization" TEXT, "expirationBehavior" "ExpirationBehavior" NOT NULL DEFAULT 'DOES_NOT_EXPIRE',
  "defaultValidityMonths" INTEGER, "credentialNumberExpected" BOOLEAN NOT NULL DEFAULT false,
  "documentExpected" BOOLEAN NOT NULL DEFAULT false, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QualificationType_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "EmployeeQualification" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "qualificationTypeId" TEXT NOT NULL,
  "credentialNumber" TEXT, "issuingOrganization" TEXT, "issueDate" TIMESTAMP(3), "expirationDate" TIMESTAMP(3),
  "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED', "verifiedAt" TIMESTAMP(3), "verifiedByUserId" TEXT,
  "verificationNote" TEXT, "notes" TEXT, "archivedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "EmployeeQualification_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "QualificationDocument" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "employeeQualificationId" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL, "storageKey" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "uploadedByUserId" TEXT,
  CONSTRAINT "QualificationDocument_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PositionQualificationRequirement" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "positionId" TEXT NOT NULL, "qualificationTypeId" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true, "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PositionQualificationRequirement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QualificationType_organizationId_name_key" ON "QualificationType"("organizationId", "name");
CREATE INDEX "QualificationType_organizationId_active_idx" ON "QualificationType"("organizationId", "active");
CREATE INDEX "EmployeeQualification_organizationId_expirationDate_idx" ON "EmployeeQualification"("organizationId", "expirationDate");
CREATE INDEX "EmployeeQualification_employeeId_qualificationTypeId_idx" ON "EmployeeQualification"("employeeId", "qualificationTypeId");
CREATE INDEX "EmployeeQualification_organizationId_verificationStatus_idx" ON "EmployeeQualification"("organizationId", "verificationStatus");
CREATE UNIQUE INDEX "QualificationDocument_organizationId_storageKey_key" ON "QualificationDocument"("organizationId", "storageKey");
CREATE INDEX "QualificationDocument_employeeQualificationId_idx" ON "QualificationDocument"("employeeQualificationId");
CREATE UNIQUE INDEX "PositionQualificationRequirement_positionId_qualificationTypeId_key" ON "PositionQualificationRequirement"("positionId", "qualificationTypeId");
CREATE INDEX "PositionQualificationRequirement_organizationId_qualificationTypeId_idx" ON "PositionQualificationRequirement"("organizationId", "qualificationTypeId");

ALTER TABLE "QualificationType" ADD CONSTRAINT "QualificationType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeQualification" ADD CONSTRAINT "EmployeeQualification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeQualification" ADD CONSTRAINT "EmployeeQualification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeQualification" ADD CONSTRAINT "EmployeeQualification_qualificationTypeId_fkey" FOREIGN KEY ("qualificationTypeId") REFERENCES "QualificationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualificationDocument" ADD CONSTRAINT "QualificationDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QualificationDocument" ADD CONSTRAINT "QualificationDocument_employeeQualificationId_fkey" FOREIGN KEY ("employeeQualificationId") REFERENCES "EmployeeQualification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PositionQualificationRequirement" ADD CONSTRAINT "PositionQualificationRequirement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PositionQualificationRequirement" ADD CONSTRAINT "PositionQualificationRequirement_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PositionQualificationRequirement" ADD CONSTRAINT "PositionQualificationRequirement_qualificationTypeId_fkey" FOREIGN KEY ("qualificationTypeId") REFERENCES "QualificationType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
