
-- CreateEnum
CREATE TYPE "TrainingDeliveryMethod" AS ENUM ('IN_PERSON', 'VIRTUAL', 'ONLINE_SELF_PACED', 'BLENDED', 'OTHER');

-- CreateEnum
CREATE TYPE "TrainingSessionStatus" AS ENUM ('PLANNED', 'OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrainingEnrollmentStatus" AS ENUM ('ENROLLED', 'ATTENDED', 'COMPLETED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrainingQualificationEffect" AS ENUM ('NONE', 'SUGGEST', 'CREATE_UNVERIFIED', 'CREATE_VERIFIED');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('INSPECTION', 'PREVENTIVE', 'REPAIR', 'DAMAGE', 'CALIBRATION', 'SOFTWARE_FIRMWARE', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'AWAITING_PARTS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "MeterUnit" AS ENUM ('HOURS', 'MILES', 'CYCLES');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationCategory" ADD VALUE 'TRAINING';
ALTER TYPE "NotificationCategory" ADD VALUE 'MAINTENANCE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'TRAINING_ENROLLED';
ALTER TYPE "NotificationType" ADD VALUE 'TRAINING_SESSION_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'TRAINING_SESSION_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'TRAINING_VERIFICATION_NEEDED';
ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_DUE_SOON';
ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'EQUIPMENT_UNAVAILABLE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEntityType" ADD VALUE 'TRAINING_SESSION';
ALTER TYPE "NotificationEntityType" ADD VALUE 'TRAINING_RECORD';
ALTER TYPE "NotificationEntityType" ADD VALUE 'MAINTENANCE_RECORD';
ALTER TYPE "NotificationEntityType" ADD VALUE 'EQUIPMENT';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "allowTrainingSelfEnrollment" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "allowVerifiedQualificationFromTraining" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoPostMaintenanceCostToLedger" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "employeesCanReportMaintenance" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maintenanceDueSoonDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "maintenanceMeterWarningPercent" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "managersCanManageMaintenance" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "managersCanVerifyTraining" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trainingSessionReminderDays" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "meterUnit" "MeterUnit";

-- AlterTable
ALTER TABLE "DocumentRelation" ADD COLUMN     "maintenanceRecordId" TEXT,
ADD COLUMN     "trainingCourseId" TEXT,
ADD COLUMN     "trainingRecordId" TEXT,
ADD COLUMN     "trainingSessionId" TEXT;

-- AlterTable
ALTER TABLE "LedgerTransaction" ADD COLUMN     "maintenanceRecordId" TEXT;

-- CreateTable
CREATE TABLE "TrainingCourse" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "provider" TEXT,
    "defaultDurationHours" DECIMAL(6,2),
    "deliveryMethod" "TrainingDeliveryMethod",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingCourseQualification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trainingCourseId" TEXT NOT NULL,
    "qualificationTypeId" TEXT NOT NULL,
    "effect" "TrainingQualificationEffect" NOT NULL DEFAULT 'SUGGEST',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingCourseQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trainingCourseId" TEXT NOT NULL,
    "titleOverride" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "location" TEXT,
    "instructor" TEXT,
    "providerOverride" TEXT,
    "maxParticipants" INTEGER,
    "notes" TEXT,
    "status" "TrainingSessionStatus" NOT NULL DEFAULT 'PLANNED',
    "createdByUserId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingEnrollment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "trainingSessionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "TrainingEnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
    "completionDate" DATE,
    "hoursCompleted" DECIMAL(6,2),
    "score" DECIMAL(6,2),
    "passed" BOOLEAN,
    "notes" TEXT,
    "employeeQualificationId" TEXT,
    "enrolledByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeTrainingRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "trainingCourseId" TEXT,
    "courseName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "completionDate" DATE NOT NULL,
    "hours" DECIMAL(6,2),
    "certificateNumber" TEXT,
    "notes" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedByUserId" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectionReason" TEXT,
    "employeeQualificationId" TEXT,
    "submittedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeTrainingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "type" "MaintenanceType" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "performedByEmployeeId" TEXT,
    "vendorName" TEXT,
    "description" TEXT NOT NULL,
    "workPerformed" TEXT,
    "cost" DECIMAL(12,2),
    "meterReading" DECIMAL(12,1),
    "nextServiceDate" DATE,
    "nextServiceMeter" DECIMAL(12,1),
    "notes" TEXT,
    "inspectionResult" "InspectionResult",
    "conditionFound" "EquipmentCondition",
    "equipmentStatusApplied" "EquipmentStatus",
    "unavailableAt" TIMESTAMP(3),
    "returnedToServiceAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "title" TEXT,
    "intervalDays" INTEGER,
    "intervalMonths" INTEGER,
    "intervalMeter" DECIMAL(12,1),
    "lastServiceDate" DATE,
    "lastServiceMeter" DECIMAL(12,1),
    "nextServiceDate" DATE,
    "nextServiceMeter" DECIMAL(12,1),
    "responsibleEmployeeId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "reading" DECIMAL(12,1) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByUserId" TEXT NOT NULL,
    "maintenanceRecordId" TEXT,
    "notes" TEXT,

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingCourse_organizationId_active_idx" ON "TrainingCourse"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCourse_organizationId_name_key" ON "TrainingCourse"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCourse_organizationId_code_key" ON "TrainingCourse"("organizationId", "code");

-- CreateIndex
CREATE INDEX "TrainingCourseQualification_organizationId_qualificationTyp_idx" ON "TrainingCourseQualification"("organizationId", "qualificationTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCourseQualification_trainingCourseId_qualificationT_key" ON "TrainingCourseQualification"("trainingCourseId", "qualificationTypeId");

-- CreateIndex
CREATE INDEX "TrainingSession_organizationId_startAt_idx" ON "TrainingSession"("organizationId", "startAt");

-- CreateIndex
CREATE INDEX "TrainingSession_organizationId_status_startAt_idx" ON "TrainingSession"("organizationId", "status", "startAt");

-- CreateIndex
CREATE INDEX "TrainingSession_trainingCourseId_idx" ON "TrainingSession"("trainingCourseId");

-- CreateIndex
CREATE INDEX "TrainingEnrollment_organizationId_employeeId_status_idx" ON "TrainingEnrollment"("organizationId", "employeeId", "status");

-- CreateIndex
CREATE INDEX "TrainingEnrollment_organizationId_completionDate_idx" ON "TrainingEnrollment"("organizationId", "completionDate");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEnrollment_trainingSessionId_employeeId_key" ON "TrainingEnrollment"("trainingSessionId", "employeeId");

-- CreateIndex
CREATE INDEX "EmployeeTrainingRecord_organizationId_employeeId_completion_idx" ON "EmployeeTrainingRecord"("organizationId", "employeeId", "completionDate");

-- CreateIndex
CREATE INDEX "EmployeeTrainingRecord_organizationId_verified_rejectedAt_idx" ON "EmployeeTrainingRecord"("organizationId", "verified", "rejectedAt");

-- CreateIndex
CREATE INDEX "EmployeeTrainingRecord_organizationId_completionDate_idx" ON "EmployeeTrainingRecord"("organizationId", "completionDate");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_organizationId_status_openedAt_idx" ON "MaintenanceRecord"("organizationId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_organizationId_equipmentId_openedAt_idx" ON "MaintenanceRecord"("organizationId", "equipmentId", "openedAt");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_organizationId_completedAt_idx" ON "MaintenanceRecord"("organizationId", "completedAt");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_organizationId_type_idx" ON "MaintenanceRecord"("organizationId", "type");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_organizationId_active_nextServiceDate_idx" ON "MaintenanceSchedule"("organizationId", "active", "nextServiceDate");

-- CreateIndex
CREATE INDEX "MaintenanceSchedule_organizationId_equipmentId_idx" ON "MaintenanceSchedule"("organizationId", "equipmentId");

-- CreateIndex
CREATE INDEX "MeterReading_organizationId_equipmentId_recordedAt_idx" ON "MeterReading"("organizationId", "equipmentId", "recordedAt" DESC);

-- CreateIndex
CREATE INDEX "DocumentRelation_organizationId_trainingRecordId_idx" ON "DocumentRelation"("organizationId", "trainingRecordId");

-- CreateIndex
CREATE INDEX "DocumentRelation_organizationId_trainingSessionId_idx" ON "DocumentRelation"("organizationId", "trainingSessionId");

-- CreateIndex
CREATE INDEX "DocumentRelation_organizationId_maintenanceRecordId_idx" ON "DocumentRelation"("organizationId", "maintenanceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_maintenanceRecordId_key" ON "LedgerTransaction"("maintenanceRecordId");

-- AddForeignKey
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_trainingCourseId_fkey" FOREIGN KEY ("trainingCourseId") REFERENCES "TrainingCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_trainingSessionId_fkey" FOREIGN KEY ("trainingSessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_trainingRecordId_fkey" FOREIGN KEY ("trainingRecordId") REFERENCES "EmployeeTrainingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_maintenanceRecordId_fkey" FOREIGN KEY ("maintenanceRecordId") REFERENCES "MaintenanceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_maintenanceRecordId_fkey" FOREIGN KEY ("maintenanceRecordId") REFERENCES "MaintenanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCourse" ADD CONSTRAINT "TrainingCourse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCourseQualification" ADD CONSTRAINT "TrainingCourseQualification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCourseQualification" ADD CONSTRAINT "TrainingCourseQualification_trainingCourseId_fkey" FOREIGN KEY ("trainingCourseId") REFERENCES "TrainingCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCourseQualification" ADD CONSTRAINT "TrainingCourseQualification_qualificationTypeId_fkey" FOREIGN KEY ("qualificationTypeId") REFERENCES "QualificationType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_trainingCourseId_fkey" FOREIGN KEY ("trainingCourseId") REFERENCES "TrainingCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSession" ADD CONSTRAINT "TrainingSession_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_trainingSessionId_fkey" FOREIGN KEY ("trainingSessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_employeeQualificationId_fkey" FOREIGN KEY ("employeeQualificationId") REFERENCES "EmployeeQualification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTrainingRecord" ADD CONSTRAINT "EmployeeTrainingRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTrainingRecord" ADD CONSTRAINT "EmployeeTrainingRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTrainingRecord" ADD CONSTRAINT "EmployeeTrainingRecord_trainingCourseId_fkey" FOREIGN KEY ("trainingCourseId") REFERENCES "TrainingCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTrainingRecord" ADD CONSTRAINT "EmployeeTrainingRecord_employeeQualificationId_fkey" FOREIGN KEY ("employeeQualificationId") REFERENCES "EmployeeQualification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "MaintenanceSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_performedByEmployeeId_fkey" FOREIGN KEY ("performedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceSchedule" ADD CONSTRAINT "MaintenanceSchedule_responsibleEmployeeId_fkey" FOREIGN KEY ("responsibleEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_maintenanceRecordId_fkey" FOREIGN KEY ("maintenanceRecordId") REFERENCES "MaintenanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data-quality guards (not expressible in the Prisma schema).
ALTER TABLE "EmployeeTrainingRecord" ADD CONSTRAINT "EmployeeTrainingRecord_hours_check" CHECK ("hours" IS NULL OR "hours" >= 0);
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_hours_check" CHECK ("hoursCompleted" IS NULL OR "hoursCompleted" >= 0);
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_cost_check" CHECK ("cost" IS NULL OR "cost" >= 0);

-- Each document relation still points at exactly one record; extend the rule to the new targets.
ALTER TABLE "DocumentRelation" DROP CONSTRAINT "DocumentRelation_exactly_one_target";
ALTER TABLE "DocumentRelation" ADD CONSTRAINT "DocumentRelation_exactly_one_target" CHECK (
  num_nonnulls("employeeId","employeeQualificationId","projectId","taskId","clientId","rentalId","equipmentId","trainingCourseId","trainingSessionId","trainingRecordId","maintenanceRecordId") = 1
);
