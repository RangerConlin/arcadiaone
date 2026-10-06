-- Settings, global search and import/export.
-- Additive only: new nullable/defaulted Organization columns, two new tables, trigram indexes.
-- pg_trgm powers case-insensitive partial matching (ILIKE '%term%') for global search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Import-completion notifications (new enum values are additive).
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'SYSTEM';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'IMPORT_COMPLETED';


-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "defaultRentalTerms" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "featureClientPortal" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "featureLedger" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "featureMaintenance" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "featureRentals" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "featureTraining" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "generalEmail" TEXT,
ADD COLUMN     "invoiceDefaultDueDays" INTEGER,
ADD COLUMN     "invoiceDefaultTerms" TEXT,
ADD COLUMN     "ledgerPrefix" TEXT NOT NULL DEFAULT 'LT-',
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "logoMimeType" TEXT,
ADD COLUMN     "logoStorageKey" TEXT,
ADD COLUMN     "notificationDefaultOffCategories" "NotificationCategory"[] DEFAULT ARRAY[]::"NotificationCategory"[],
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "qualificationAutoVerifyAdminEntries" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "NumberSequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "autoAssign" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'CREATE',
    "status" "ImportJobStatus" NOT NULL DEFAULT 'PENDING',
    "mapping" JSONB,
    "stagedRows" JSONB,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsProcessed" INTEGER NOT NULL DEFAULT 0,
    "rowsCreated" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsRejected" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NumberSequence_organizationId_entity_key" ON "NumberSequence"("organizationId", "entity");

-- CreateIndex
CREATE INDEX "ImportJob_organizationId_createdAt_idx" ON "ImportJob"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_status_createdAt_idx" ON "ImportJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Employee_firstName_trgm" ON "Employee" USING GIN ("firstName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Employee_lastName_trgm" ON "Employee" USING GIN ("lastName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Employee_employeeNumber_trgm" ON "Employee" USING GIN ("employeeNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Employee_workEmail_trgm" ON "Employee" USING GIN ("workEmail" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Project_name_trgm" ON "Project" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Project_projectNumber_trgm" ON "Project" USING GIN ("projectNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Client_name_trgm" ON "Client" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Client_displayName_trgm" ON "Client" USING GIN ("displayName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Client_clientNumber_trgm" ON "Client" USING GIN ("clientNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ClientContact_firstName_trgm" ON "ClientContact" USING GIN ("firstName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ClientContact_lastName_trgm" ON "ClientContact" USING GIN ("lastName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ClientContact_email_trgm" ON "ClientContact" USING GIN ("email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Task_title_trgm" ON "Task" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "QualificationType_name_trgm" ON "QualificationType" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Equipment_name_trgm" ON "Equipment" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Equipment_assetNumber_trgm" ON "Equipment" USING GIN ("assetNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Equipment_serialNumber_trgm" ON "Equipment" USING GIN ("serialNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Rental_rentalNumber_trgm" ON "Rental" USING GIN ("rentalNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Document_title_trgm" ON "Document" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "DocumentVersion_originalFilename_trgm" ON "DocumentVersion" USING GIN ("originalFilename" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Invoice_invoiceNumber_trgm" ON "Invoice" USING GIN ("invoiceNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "TrainingCourse_name_trgm" ON "TrainingCourse" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "MaintenanceRecord_description_trgm" ON "MaintenanceRecord" USING GIN ("description" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "NumberSequence" ADD CONSTRAINT "NumberSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "Rental" ADD COLUMN     "terms" TEXT;
