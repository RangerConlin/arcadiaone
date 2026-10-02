CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'ARCHIVED');
CREATE TYPE "ProjectPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ProjectActivityType" AS ENUM ('NOTE', 'SYSTEM');

CREATE TABLE "Project" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "projectNumber" TEXT, "name" TEXT NOT NULL,
  "description" TEXT, "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING', "priority" "ProjectPriority" NOT NULL DEFAULT 'NORMAL',
  "startDate" TIMESTAMP(3), "targetEndDate" TIMESTAMP(3), "actualEndDate" TIMESTAMP(3), "projectManagerId" TEXT,
  "clientName" TEXT, "location" TEXT, "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProjectRole" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ProjectRole_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProjectMember" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "employeeId" TEXT NOT NULL,
  "projectRoleId" TEXT, "joinedAt" TIMESTAMP(3), "leftAt" TIMESTAMP(3), "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProjectMilestone" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT, "targetDate" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
  "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING', "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProjectActivity" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "type" "ProjectActivityType" NOT NULL DEFAULT 'NOTE', "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ProjectActivity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Project_organizationId_projectNumber_key" ON "Project"("organizationId", "projectNumber");
CREATE INDEX "Project_organizationId_status_idx" ON "Project"("organizationId", "status");
CREATE INDEX "Project_organizationId_projectManagerId_idx" ON "Project"("organizationId", "projectManagerId");
CREATE INDEX "Project_organizationId_name_idx" ON "Project"("organizationId", "name");
CREATE UNIQUE INDEX "ProjectRole_organizationId_name_key" ON "ProjectRole"("organizationId", "name");
CREATE INDEX "ProjectRole_organizationId_active_idx" ON "ProjectRole"("organizationId", "active");
CREATE UNIQUE INDEX "ProjectMember_projectId_employeeId_key" ON "ProjectMember"("projectId", "employeeId");
CREATE INDEX "ProjectMember_organizationId_employeeId_idx" ON "ProjectMember"("organizationId", "employeeId");
CREATE INDEX "ProjectMilestone_organizationId_projectId_sortOrder_idx" ON "ProjectMilestone"("organizationId", "projectId", "sortOrder");
CREATE INDEX "ProjectMilestone_organizationId_status_targetDate_idx" ON "ProjectMilestone"("organizationId", "status", "targetDate");
CREATE INDEX "ProjectActivity_organizationId_projectId_createdAt_idx" ON "ProjectActivity"("organizationId", "projectId", "createdAt");
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectRole" ADD CONSTRAINT "ProjectRole_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectRoleId_fkey" FOREIGN KEY ("projectRoleId") REFERENCES "ProjectRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectActivity" ADD CONSTRAINT "ProjectActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
