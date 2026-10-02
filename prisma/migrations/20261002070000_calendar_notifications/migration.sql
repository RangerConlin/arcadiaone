
-- CreateEnum
CREATE TYPE "CalendarEventVisibility" AS ENUM ('PRIVATE', 'PROJECT', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('TASK_ASSIGNMENTS', 'TASK_REMINDERS', 'QUALIFICATIONS', 'RENTALS', 'INVOICES', 'SIGNATURES', 'APPROVALS', 'PROJECT_UPDATES', 'DOCUMENTS');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TASK_ASSIGNED', 'TASK_DUE_TOMORROW', 'TASK_DUE_SOON', 'TASK_OVERDUE', 'QUALIFICATION_EXPIRING', 'QUALIFICATION_EXPIRED', 'RENTAL_DUE_SOON', 'RENTAL_OVERDUE', 'INVOICE_DUE_SOON', 'INVOICE_OVERDUE', 'SIGNATURE_REQUESTED', 'APPROVAL_REQUESTED', 'CLIENT_RESPONSE_RECEIVED', 'PROJECT_MEMBER_ADDED', 'DOCUMENT_SHARED');

-- CreateEnum
CREATE TYPE "NotificationEntityType" AS ENUM ('TASK', 'PROJECT', 'EMPLOYEE_QUALIFICATION', 'RENTAL', 'INVOICE', 'SIGNATURE_REQUEST', 'CLIENT_APPROVAL_REQUEST', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "invoiceDueSoonDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "notificationArchiveAfterDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "rentalDueSoonDays" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "taskDueSoonDays" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "timezone" TEXT;

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "visibility" "CalendarEventVisibility" NOT NULL DEFAULT 'ORGANIZATION',
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "assignedEmployeeId" TEXT,
    "projectId" TEXT,
    "clientId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "relatedEntityType" "NotificationEntityType",
    "relatedEntityId" TEXT,
    "actionUrl" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_organizationId_startAt_idx" ON "CalendarEvent"("organizationId", "startAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_organizationId_assignedEmployeeId_startAt_idx" ON "CalendarEvent"("organizationId", "assignedEmployeeId", "startAt");

-- CreateIndex
CREATE INDEX "CalendarEvent_organizationId_projectId_idx" ON "CalendarEvent"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "CalendarEvent_organizationId_createdByUserId_idx" ON "CalendarEvent"("organizationId", "createdByUserId");

-- CreateIndex
CREATE INDEX "Notification_userId_archivedAt_readAt_createdAt_idx" ON "Notification"("userId", "archivedAt", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationPreference_organizationId_idx" ON "NotificationPreference"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_category_channel_key" ON "NotificationPreference"("userId", "category", "channel");

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_assignedEmployeeId_fkey" FOREIGN KEY ("assignedEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

