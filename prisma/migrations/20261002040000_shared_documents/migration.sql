CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "DocumentSensitivity" AS ENUM ('NORMAL', 'RESTRICTED');
CREATE TYPE "DocumentActivityType" AS ENUM ('UPLOADED', 'VERSION_UPLOADED', 'METADATA_CHANGED', 'ARCHIVED', 'RESTORED');

CREATE TABLE "DocumentCategory" ("id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "DocumentCategory_pkey" PRIMARY KEY ("id"));
CREATE TABLE "Document" ("id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT, "categoryId" TEXT, "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE', "sensitivity" "DocumentSensitivity" NOT NULL DEFAULT 'NORMAL', "currentVersionId" TEXT, "createdByUserId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL, "archivedAt" TIMESTAMP(3), CONSTRAINT "Document_pkey" PRIMARY KEY ("id"));
CREATE TABLE "DocumentVersion" ("id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "documentId" TEXT NOT NULL, "versionNumber" INTEGER NOT NULL, "originalFilename" TEXT NOT NULL, "storageKey" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "sizeBytes" INTEGER NOT NULL, "checksum" TEXT NOT NULL, "uploadedByUserId" TEXT NOT NULL, "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "notes" TEXT, CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id"));
CREATE TABLE "DocumentRelation" ("id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "documentId" TEXT NOT NULL, "employeeId" TEXT, "employeeQualificationId" TEXT, "projectId" TEXT, "taskId" TEXT, "clientId" TEXT, "rentalId" TEXT, "equipmentId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "DocumentRelation_pkey" PRIMARY KEY ("id"), CONSTRAINT "DocumentRelation_exactly_one_target" CHECK (num_nonnulls("employeeId","employeeQualificationId","projectId","taskId","clientId","rentalId","equipmentId") = 1));
CREATE TABLE "DocumentActivity" ("id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "documentId" TEXT NOT NULL, "userId" TEXT NOT NULL, "type" "DocumentActivityType" NOT NULL, "detail" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "DocumentActivity_pkey" PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "DocumentCategory_organizationId_name_key" ON "DocumentCategory"("organizationId","name");
CREATE UNIQUE INDEX "Document_currentVersionId_key" ON "Document"("currentVersionId");
CREATE UNIQUE INDEX "DocumentVersion_documentId_versionNumber_key" ON "DocumentVersion"("documentId","versionNumber");
CREATE UNIQUE INDEX "DocumentVersion_organizationId_storageKey_key" ON "DocumentVersion"("organizationId","storageKey");
CREATE INDEX "Document_organizationId_status_updatedAt_idx" ON "Document"("organizationId","status","updatedAt");
CREATE INDEX "Document_organizationId_categoryId_idx" ON "Document"("organizationId","categoryId");
CREATE INDEX "DocumentRelation_organizationId_documentId_idx" ON "DocumentRelation"("organizationId","documentId");
CREATE INDEX "DocumentRelation_organizationId_employeeId_idx" ON "DocumentRelation"("organizationId","employeeId");
CREATE INDEX "DocumentRelation_organizationId_employeeQualificationId_idx" ON "DocumentRelation"("organizationId","employeeQualificationId");
CREATE INDEX "DocumentRelation_organizationId_projectId_idx" ON "DocumentRelation"("organizationId","projectId");
CREATE INDEX "DocumentRelation_organizationId_taskId_idx" ON "DocumentRelation"("organizationId","taskId");
CREATE INDEX "DocumentRelation_organizationId_clientId_idx" ON "DocumentRelation"("organizationId","clientId");
CREATE INDEX "DocumentRelation_organizationId_rentalId_idx" ON "DocumentRelation"("organizationId","rentalId");
CREATE INDEX "DocumentRelation_organizationId_equipmentId_idx" ON "DocumentRelation"("organizationId","equipmentId");
CREATE INDEX "DocumentActivity_organizationId_documentId_createdAt_idx" ON "DocumentActivity"("organizationId","documentId","createdAt");

ALTER TABLE "DocumentCategory" ADD CONSTRAINT "DocumentCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT;
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT;
ALTER TABLE "Document" ADD CONSTRAINT "Document_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DocumentCategory"("id") ON DELETE SET NULL;
ALTER TABLE "Document" ADD CONSTRAINT "Document_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT;
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE;
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT;
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE;
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE;
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_employeeQualificationId_fkey" FOREIGN KEY ("employeeQualificationId") REFERENCES "EmployeeQualification"("id") ON DELETE CASCADE;
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE;
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE;
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE;
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "Rental"("id") ON DELETE CASCADE;
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE;
ALTER TABLE "DocumentActivity" ADD CONSTRAINT "DocumentActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT;
ALTER TABLE "DocumentActivity" ADD CONSTRAINT "DocumentActivity_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE;
ALTER TABLE "DocumentActivity" ADD CONSTRAINT "DocumentActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT;

-- Non-destructively promote every legacy qualification file. Legacy rows and storage keys remain intact.
INSERT INTO "Document" ("id","organizationId","title","createdByUserId","createdAt","updatedAt")
SELECT qd."id", qd."organizationId", qd."originalFilename", COALESCE(qd."uploadedByUserId", u."id"), qd."uploadedAt", qd."uploadedAt"
FROM "QualificationDocument" qd JOIN LATERAL (SELECT "id" FROM "User" WHERE "organizationId"=qd."organizationId" ORDER BY "createdAt" LIMIT 1) u ON true;
INSERT INTO "DocumentVersion" ("id","organizationId","documentId","versionNumber","originalFilename","storageKey","mimeType","sizeBytes","checksum","uploadedByUserId","uploadedAt")
SELECT gen_random_uuid()::text,d."organizationId",d."id",1,qd."originalFilename",qd."storageKey",qd."mimeType",qd."sizeBytes",'legacy-unavailable',COALESCE(qd."uploadedByUserId",u."id"),qd."uploadedAt"
FROM "QualificationDocument" qd JOIN "Document" d ON d."id"=qd."id" JOIN LATERAL (SELECT "id" FROM "User" WHERE "organizationId"=qd."organizationId" ORDER BY "createdAt" LIMIT 1) u ON true;
UPDATE "Document" d SET "currentVersionId"=v."id" FROM "DocumentVersion" v WHERE v."documentId"=d."id";
INSERT INTO "DocumentRelation" ("id","organizationId","documentId","employeeQualificationId") SELECT gen_random_uuid()::text,qd."organizationId",d."id",qd."employeeQualificationId" FROM "QualificationDocument" qd JOIN "Document" d ON d."id"=qd."id";
ALTER TABLE "Document" ADD CONSTRAINT "Document_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL;
