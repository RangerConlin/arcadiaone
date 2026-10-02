-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'PREPARING', 'CHECKED_OUT', 'INSPECTION', 'MAINTENANCE', 'OUT_OF_SERVICE', 'LOST');

-- CreateEnum
CREATE TYPE "EquipmentCondition" AS ENUM ('NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "RentalRateUnit" AS ENUM ('FLAT', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "RentalStatus" AS ENUM ('DRAFT', 'RESERVED', 'PREPARING', 'READY', 'CHECKED_OUT', 'PARTIALLY_RETURNED', 'RETURNED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RentalActivityType" AS ENUM ('CREATED', 'RESERVED', 'ITEM_ADDED', 'ITEM_REMOVED', 'PREPARATION_COMPLETED', 'CHECKED_OUT', 'ITEM_RETURNED', 'DAMAGE_NOTED', 'SENT_TO_INSPECTION', 'RETURNED_TO_SERVICE', 'STATUS_CHANGED', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "EquipmentCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" "EquipmentCondition" NOT NULL DEFAULT 'GOOD',
    "purchaseDate" TIMESTAMP(3),
    "purchaseCost" DECIMAL(12,2),
    "replacementValue" DECIMAL(12,2),
    "defaultRentalRate" DECIMAL(12,2),
    "rateUnit" "RentalRateUnit",
    "rentable" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "locationId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rental" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rentalNumber" TEXT NOT NULL,
    "clientId" TEXT,
    "clientContactId" TEXT,
    "projectId" TEXT,
    "status" "RentalStatus" NOT NULL DEFAULT 'DRAFT',
    "reservationStart" TIMESTAMP(3) NOT NULL,
    "reservationEnd" TIMESTAMP(3) NOT NULL,
    "checkedOutAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "preparedByEmployeeId" TEXT,
    "checkedOutByEmployeeId" TEXT,
    "receivedByEmployeeId" TEXT,
    "customerReference" TEXT,
    "pickupNotes" TEXT,
    "returnNotes" TEXT,
    "internalNotes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rental_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalItem" (
    "id" TEXT NOT NULL,
    "rentalId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "rate" DECIMAL(12,2),
    "rateUnit" "RentalRateUnit",
    "preparationNotes" TEXT,
    "preparedAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "checkoutCondition" "EquipmentCondition",
    "returnCondition" "EquipmentCondition",
    "checkoutNotes" TEXT,
    "returnNotes" TEXT,

    CONSTRAINT "RentalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rentalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "RentalActivityType" NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentPackage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentPackageItem" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "EquipmentPackageItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquipmentCategory_organizationId_active_idx" ON "EquipmentCategory"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentCategory_organizationId_name_key" ON "EquipmentCategory"("organizationId", "name");

-- CreateIndex
CREATE INDEX "EquipmentLocation_organizationId_active_idx" ON "EquipmentLocation"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentLocation_organizationId_name_key" ON "EquipmentLocation"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Equipment_organizationId_status_active_rentable_idx" ON "Equipment"("organizationId", "status", "active", "rentable");

-- CreateIndex
CREATE INDEX "Equipment_organizationId_categoryId_idx" ON "Equipment"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "Equipment_organizationId_locationId_idx" ON "Equipment"("organizationId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_organizationId_assetNumber_key" ON "Equipment"("organizationId", "assetNumber");

-- CreateIndex
CREATE INDEX "Rental_organizationId_status_reservationStart_reservationEn_idx" ON "Rental"("organizationId", "status", "reservationStart", "reservationEnd");

-- CreateIndex
CREATE INDEX "Rental_organizationId_clientId_idx" ON "Rental"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "Rental_organizationId_projectId_idx" ON "Rental"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Rental_organizationId_rentalNumber_key" ON "Rental"("organizationId", "rentalNumber");

-- CreateIndex
CREATE INDEX "RentalItem_equipmentId_checkedOutAt_returnedAt_idx" ON "RentalItem"("equipmentId", "checkedOutAt", "returnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RentalItem_rentalId_equipmentId_key" ON "RentalItem"("rentalId", "equipmentId");

-- CreateIndex
CREATE INDEX "RentalActivity_organizationId_rentalId_createdAt_idx" ON "RentalActivity"("organizationId", "rentalId", "createdAt");

-- CreateIndex
CREATE INDEX "EquipmentPackage_organizationId_active_idx" ON "EquipmentPackage"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentPackage_organizationId_name_key" ON "EquipmentPackage"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentPackageItem_packageId_categoryId_key" ON "EquipmentPackageItem"("packageId", "categoryId");

-- AddForeignKey
ALTER TABLE "EquipmentCategory" ADD CONSTRAINT "EquipmentCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentLocation" ADD CONSTRAINT "EquipmentLocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EquipmentCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "EquipmentLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_clientContactId_fkey" FOREIGN KEY ("clientContactId") REFERENCES "ClientContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_preparedByEmployeeId_fkey" FOREIGN KEY ("preparedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_checkedOutByEmployeeId_fkey" FOREIGN KEY ("checkedOutByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_receivedByEmployeeId_fkey" FOREIGN KEY ("receivedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalItem" ADD CONSTRAINT "RentalItem_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "Rental"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalItem" ADD CONSTRAINT "RentalItem_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalActivity" ADD CONSTRAINT "RentalActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalActivity" ADD CONSTRAINT "RentalActivity_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "Rental"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalActivity" ADD CONSTRAINT "RentalActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentPackage" ADD CONSTRAINT "EquipmentPackage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentPackageItem" ADD CONSTRAINT "EquipmentPackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "EquipmentPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentPackageItem" ADD CONSTRAINT "EquipmentPackageItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EquipmentCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

