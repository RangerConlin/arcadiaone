-- Adds project lifecycle statuses for the external inquiry API, and the
-- ApiKey / ProjectInquirySubmission tables used to authenticate integrations
-- and deduplicate their submissions.

-- AlterEnum
ALTER TYPE "ProjectStatus" ADD VALUE 'INQUIRY';
ALTER TYPE "ProjectStatus" ADD VALUE 'PROPOSED';
ALTER TYPE "ProjectStatus" ADD VALUE 'APPROVED';

-- CreateEnum
CREATE TYPE "ApiKeyPermission" AS ENUM ('PROJECT_INQUIRIES_CREATE');

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "permissions" "ApiKeyPermission"[],
    "defaultSource" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectInquirySubmission" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectInquirySubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_idx" ON "ApiKey"("organizationId");

-- CreateIndex
CREATE INDEX "ProjectInquirySubmission_organizationId_idx" ON "ProjectInquirySubmission"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInquirySubmission_apiKeyId_submissionId_key" ON "ProjectInquirySubmission"("apiKeyId", "submissionId");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInquirySubmission" ADD CONSTRAINT "ProjectInquirySubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInquirySubmission" ADD CONSTRAINT "ProjectInquirySubmission_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInquirySubmission" ADD CONSTRAINT "ProjectInquirySubmission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
