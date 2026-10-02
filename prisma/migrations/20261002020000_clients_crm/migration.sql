-- Lightweight client relationship management. Project.clientName is deliberately retained.
CREATE TYPE "ClientStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE "ClientType" AS ENUM ('BUSINESS', 'GOVERNMENT', 'NONPROFIT', 'INDIVIDUAL', 'OTHER');
CREATE TYPE "PreferredContactMethod" AS ENUM ('EMAIL', 'PHONE', 'MOBILE');
CREATE TYPE "ClientActivityType" AS ENUM ('PHONE_CALL', 'EMAIL', 'MEETING', 'NOTE', 'OTHER');

CREATE TABLE "Client" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "createdByUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL, "displayName" TEXT, "clientNumber" TEXT, "status" "ClientStatus" NOT NULL DEFAULT 'PROSPECT',
  "type" "ClientType", "primaryContactId" TEXT, "website" TEXT, "mainPhone" TEXT, "generalEmail" TEXT,
  "addressLine1" TEXT, "addressLine2" TEXT, "city" TEXT, "stateProvince" TEXT, "postalCode" TEXT, "country" TEXT,
  "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ClientContact" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "firstName" TEXT NOT NULL, "lastName" TEXT NOT NULL,
  "title" TEXT, "email" TEXT, "phone" TEXT, "mobilePhone" TEXT, "preferredContactMethod" "PreferredContactMethod",
  "primary" BOOLEAN NOT NULL DEFAULT false, "active" BOOLEAN NOT NULL DEFAULT true, "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ClientActivity" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "clientId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "activityType" "ClientActivityType" NOT NULL DEFAULT 'NOTE', "summary" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientActivity_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Project" ADD COLUMN "clientId" TEXT;
CREATE UNIQUE INDEX "Client_organizationId_clientNumber_key" ON "Client"("organizationId", "clientNumber");
CREATE INDEX "Client_organizationId_status_name_idx" ON "Client"("organizationId", "status", "name");
CREATE INDEX "Client_createdByUserId_idx" ON "Client"("createdByUserId");
CREATE INDEX "ClientContact_organizationId_clientId_active_idx" ON "ClientContact"("organizationId", "clientId", "active");
CREATE INDEX "ClientContact_organizationId_lastName_firstName_idx" ON "ClientContact"("organizationId", "lastName", "firstName");
CREATE INDEX "ClientActivity_organizationId_clientId_occurredAt_idx" ON "ClientActivity"("organizationId", "clientId", "occurredAt");
CREATE INDEX "Project_organizationId_clientId_idx" ON "Project"("organizationId", "clientId");
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Client" ADD CONSTRAINT "Client_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientActivity" ADD CONSTRAINT "ClientActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientActivity" ADD CONSTRAINT "ClientActivity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientActivity" ADD CONSTRAINT "ClientActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Client" ADD CONSTRAINT "Client_primaryContactId_fkey" FOREIGN KEY ("primaryContactId") REFERENCES "ClientContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
