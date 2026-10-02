
-- CreateEnum
CREATE TYPE "LedgerTransactionType" AS ENUM ('INCOME', 'EXPENSE', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "autoPostPaymentsToLedger" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nextLedgerSequence" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "LedgerCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerTransactionType",
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "transactionNumber" TEXT,
    "type" "LedgerTransactionType" NOT NULL,
    "transactionDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "categoryId" TEXT,
    "clientId" TEXT,
    "projectId" TEXT,
    "rentalId" TEXT,
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "equipmentId" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorPortalUserId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'SUCCESS',
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReportFilter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedReportFilter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LedgerCategory_organizationId_active_idx" ON "LedgerCategory"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerCategory_organizationId_name_key" ON "LedgerCategory"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_paymentId_key" ON "LedgerTransaction"("paymentId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_organizationId_transactionDate_idx" ON "LedgerTransaction"("organizationId", "transactionDate");

-- CreateIndex
CREATE INDEX "LedgerTransaction_organizationId_type_transactionDate_idx" ON "LedgerTransaction"("organizationId", "type", "transactionDate");

-- CreateIndex
CREATE INDEX "LedgerTransaction_organizationId_categoryId_idx" ON "LedgerTransaction"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_organizationId_clientId_idx" ON "LedgerTransaction"("organizationId", "clientId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_organizationId_projectId_idx" ON "LedgerTransaction"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_organizationId_rentalId_idx" ON "LedgerTransaction"("organizationId", "rentalId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_organizationId_invoiceId_idx" ON "LedgerTransaction"("organizationId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_organizationId_transactionNumber_key" ON "LedgerTransaction"("organizationId", "transactionNumber");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_occurredAt_idx" ON "AuditEvent"("organizationId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_entityType_entityId_idx" ON "AuditEvent"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_action_occurredAt_idx" ON "AuditEvent"("organizationId", "action", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_actorUserId_occurredAt_idx" ON "AuditEvent"("organizationId", "actorUserId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "SavedReportFilter_organizationId_userId_reportId_idx" ON "SavedReportFilter"("organizationId", "userId", "reportId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedReportFilter_userId_reportId_name_key" ON "SavedReportFilter"("userId", "reportId", "name");

-- CreateIndex
CREATE INDEX "Task_organizationId_completedAt_idx" ON "Task"("organizationId", "completedAt");

-- CreateIndex
CREATE INDEX "Payment_organizationId_paymentDate_idx" ON "Payment"("organizationId", "paymentDate");

-- AddForeignKey
ALTER TABLE "LedgerCategory" ADD CONSTRAINT "LedgerCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "LedgerCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "Rental"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReportFilter" ADD CONSTRAINT "SavedReportFilter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReportFilter" ADD CONSTRAINT "SavedReportFilter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Audit events are append-only. Retention or pruning, if ever needed, must be a deliberate
-- administrative procedure that temporarily disables this trigger; the application never does.
CREATE OR REPLACE FUNCTION audit_event_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent rows are immutable (% blocked)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_immutable"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();

-- Money safety: INCOME and EXPENSE amounts must be positive; adjustments may be signed but never zero.
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_amount_check"
  CHECK (("type" = 'ADJUSTMENT' AND "amount" <> 0) OR ("type" <> 'ADJUSTMENT' AND "amount" > 0));
