-- Extends the Project, ProjectMember and ProjectMilestone tables created by the
-- tasks migration into the full Projects module, preserving existing rows.

-- CreateEnum
CREATE TYPE "ProjectPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ProjectActivityType" AS ENUM ('NOTE', 'SYSTEM');

-- AlterEnum
ALTER TYPE "ProjectStatus" ADD VALUE 'ARCHIVED';

-- CreateTable
CREATE TABLE "ProjectRole" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "ProjectActivityType" NOT NULL DEFAULT 'NOTE',
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectActivity_pkey" PRIMARY KEY ("id")
);

-- AlterTable: Project
ALTER TABLE "Project"
    ADD COLUMN "projectNumber" TEXT,
    ADD COLUMN "priority" "ProjectPriority" NOT NULL DEFAULT 'NORMAL',
    ADD COLUMN "startDate" TIMESTAMP(3),
    ADD COLUMN "targetEndDate" TIMESTAMP(3),
    ADD COLUMN "actualEndDate" TIMESTAMP(3),
    ADD COLUMN "projectManagerId" TEXT,
    ADD COLUMN "clientName" TEXT,
    ADD COLUMN "location" TEXT,
    ADD COLUMN "notes" TEXT,
    ALTER COLUMN "status" SET DEFAULT 'PLANNING';

-- The project manager is now an employee rather than a user account.
UPDATE "Project" SET "projectManagerId" = "User"."employeeId"
FROM "User" WHERE "Project"."managerUserId" = "User"."id";
ALTER TABLE "Project" DROP CONSTRAINT "Project_managerUserId_fkey";
ALTER TABLE "Project" DROP COLUMN "managerUserId";
DROP INDEX "Project_organizationId_name_key";

-- Existing per-member role names become reusable project roles.
INSERT INTO "ProjectRole" ("id", "organizationId", "name", "updatedAt")
SELECT gen_random_uuid()::text, "Project"."organizationId", "ProjectMember"."roleName", CURRENT_TIMESTAMP
FROM "ProjectMember" JOIN "Project" ON "Project"."id" = "ProjectMember"."projectId"
WHERE "ProjectMember"."roleName" IS NOT NULL AND btrim("ProjectMember"."roleName") <> ''
GROUP BY "Project"."organizationId", "ProjectMember"."roleName";

-- AlterTable: ProjectMember
ALTER TABLE "ProjectMember"
    ADD COLUMN "organizationId" TEXT,
    ADD COLUMN "projectRoleId" TEXT,
    ADD COLUMN "joinedAt" TIMESTAMP(3),
    ADD COLUMN "leftAt" TIMESTAMP(3),
    ADD COLUMN "notes" TEXT,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "ProjectMember" SET "organizationId" = "Project"."organizationId"
FROM "Project" WHERE "ProjectMember"."projectId" = "Project"."id";
UPDATE "ProjectMember" SET "projectRoleId" = "ProjectRole"."id"
FROM "Project", "ProjectRole"
WHERE "ProjectMember"."projectId" = "Project"."id"
  AND "ProjectRole"."organizationId" = "Project"."organizationId"
  AND "ProjectRole"."name" = "ProjectMember"."roleName";
ALTER TABLE "ProjectMember" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ProjectMember" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "ProjectMember" DROP COLUMN "roleName";
ALTER TABLE "ProjectMember" DROP CONSTRAINT "ProjectMember_employeeId_fkey";
DROP INDEX "ProjectMember_employeeId_idx";

-- AlterTable: ProjectMilestone
ALTER TABLE "ProjectMilestone" RENAME COLUMN "dueDate" TO "targetDate";
ALTER TABLE "ProjectMilestone"
    ADD COLUMN "organizationId" TEXT,
    ADD COLUMN "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING';
UPDATE "ProjectMilestone" SET "organizationId" = "Project"."organizationId"
FROM "Project" WHERE "ProjectMilestone"."projectId" = "Project"."id";
UPDATE "ProjectMilestone" SET "status" = 'COMPLETED' WHERE "completedAt" IS NOT NULL;
ALTER TABLE "ProjectMilestone" ALTER COLUMN "organizationId" SET NOT NULL;
DROP INDEX "ProjectMilestone_projectId_name_key";
DROP INDEX "ProjectMilestone_projectId_sortOrder_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Project_organizationId_projectNumber_key" ON "Project"("organizationId", "projectNumber");
CREATE INDEX "Project_organizationId_projectManagerId_idx" ON "Project"("organizationId", "projectManagerId");
CREATE INDEX "Project_organizationId_name_idx" ON "Project"("organizationId", "name");
CREATE UNIQUE INDEX "ProjectRole_organizationId_name_key" ON "ProjectRole"("organizationId", "name");
CREATE INDEX "ProjectRole_organizationId_active_idx" ON "ProjectRole"("organizationId", "active");
CREATE INDEX "ProjectMember_organizationId_employeeId_idx" ON "ProjectMember"("organizationId", "employeeId");
CREATE INDEX "ProjectMilestone_organizationId_projectId_sortOrder_idx" ON "ProjectMilestone"("organizationId", "projectId", "sortOrder");
CREATE INDEX "ProjectMilestone_organizationId_status_targetDate_idx" ON "ProjectMilestone"("organizationId", "status", "targetDate");
CREATE INDEX "ProjectActivity_organizationId_projectId_createdAt_idx" ON "ProjectActivity"("organizationId", "projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectRole" ADD CONSTRAINT "ProjectRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectRoleId_fkey" FOREIGN KEY ("projectRoleId") REFERENCES "ProjectRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
