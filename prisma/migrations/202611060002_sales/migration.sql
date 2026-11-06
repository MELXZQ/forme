-- AlterTable
ALTER TABLE "ShopOrder" ADD COLUMN     "actualDiscountCents" INTEGER,
ADD COLUMN     "assigneeId" TEXT,
ADD COLUMN     "dataKind" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "etaDelivery" DATE,
ADD COLUMN     "shippingMethod" TEXT NOT NULL DEFAULT 'STANDARD_AU',
ADD COLUMN     "snapshotVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "actualDiscountCents" INTEGER,
ADD COLUMN     "campaigns" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "pricingBasis" TEXT NOT NULL DEFAULT 'LEGACY_REFERENCE_DIFFERENCE';

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "dataKind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "amountCents" INTEGER,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealCampaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "variantIds" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "DealCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedOrderFilter" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedOrderFilter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AftercareCase" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineId" TEXT,
    "quantity" INTEGER,
    "parcelId" TEXT,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "firstResponseAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "outcome" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AftercareCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Compensation" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "basis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "applicantId" TEXT NOT NULL,
    "approverId" TEXT,
    "approvalNote" TEXT NOT NULL DEFAULT '',
    "selfApproved" BOOLEAN NOT NULL DEFAULT false,
    "executorId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" TEXT NOT NULL DEFAULT '',
    "expenseId" TEXT,

    CONSTRAINT "Compensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderRefund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "compensationId" TEXT NOT NULL,
    "cashId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "dataKind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "allocations" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "OrderRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplacementShipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "compensationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "lines" JSONB NOT NULL,
    "parcelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shippedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "ReplacementShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTimeoutRule" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "days" INTEGER NOT NULL,
    "dayMode" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "weekends" INTEGER[],
    "holidays" TEXT[],
    "shippingMethod" TEXT NOT NULL DEFAULT 'STANDARD_AU',
    "includeTest" BOOLEAN NOT NULL DEFAULT false,
    "assigneeId" TEXT NOT NULL,
    "recipientIds" TEXT[],
    "confirmerIds" TEXT[],
    "severity" INTEGER NOT NULL DEFAULT 1,
    "pin" BOOLEAN NOT NULL DEFAULT true,
    "escalateDays" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "OrderTimeoutRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTimer" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "anchorAt" TIMESTAMP(3) NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderTimer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTimerPause" (
    "id" TEXT NOT NULL,
    "timerId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderTimerPause_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderEvent_eventKey_key" ON "OrderEvent"("eventKey");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_occurredAt_idx" ON "OrderEvent"("orderId", "occurredAt");

-- CreateIndex
CREATE INDEX "OrderEvent_type_dataKind_occurredAt_idx" ON "OrderEvent"("type", "dataKind", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedOrderFilter_userId_name_key" ON "SavedOrderFilter"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AftercareCase_number_key" ON "AftercareCase"("number");

-- CreateIndex
CREATE INDEX "AftercareCase_orderId_status_idx" ON "AftercareCase"("orderId", "status");

-- CreateIndex
CREATE INDEX "AftercareCase_assigneeId_status_dueAt_idx" ON "AftercareCase"("assigneeId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "Compensation_number_key" ON "Compensation"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Compensation_expenseId_key" ON "Compensation"("expenseId");

-- CreateIndex
CREATE INDEX "Compensation_orderId_status_idx" ON "Compensation"("orderId", "status");

-- CreateIndex
CREATE INDEX "Compensation_status_dueAt_idx" ON "Compensation"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRefund_compensationId_key" ON "OrderRefund"("compensationId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRefund_cashId_key" ON "OrderRefund"("cashId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderRefund_reference_key" ON "OrderRefund"("reference");

-- CreateIndex
CREATE INDEX "OrderRefund_occurredAt_dataKind_idx" ON "OrderRefund"("occurredAt", "dataKind");

-- CreateIndex
CREATE UNIQUE INDEX "ReplacementShipment_compensationId_key" ON "ReplacementShipment"("compensationId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplacementShipment_parcelId_key" ON "ReplacementShipment"("parcelId");

-- CreateIndex
CREATE INDEX "ReplacementShipment_orderId_status_idx" ON "ReplacementShipment"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderTimeoutRule_kind_version_key" ON "OrderTimeoutRule"("kind", "version");

-- CreateIndex
CREATE INDEX "OrderTimer_active_deadlineAt_idx" ON "OrderTimer"("active", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderTimer_kind_objectId_key" ON "OrderTimer"("kind", "objectId");

-- CreateIndex
CREATE INDEX "ShopOrder_dataKind_paidAt_idx" ON "ShopOrder"("dataKind", "paidAt");

-- CreateIndex
CREATE INDEX "ShopOrder_shippedAt_idx" ON "ShopOrder"("shippedAt");

-- CreateIndex
CREATE INDEX "ShopOrder_deliveredAt_idx" ON "ShopOrder"("deliveredAt");

-- CreateIndex
CREATE INDEX "ShopOrder_cancelledAt_idx" ON "ShopOrder"("cancelledAt");

-- CreateIndex
CREATE INDEX "OrderLine_productId_categoryId_idx" ON "OrderLine"("productId", "categoryId");

-- CreateIndex
CREATE INDEX "OrderLine_sku_idx" ON "OrderLine"("sku");

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AftercareCase" ADD CONSTRAINT "AftercareCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compensation" ADD CONSTRAINT "Compensation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compensation" ADD CONSTRAINT "Compensation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AftercareCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRefund" ADD CONSTRAINT "OrderRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderRefund" ADD CONSTRAINT "OrderRefund_compensationId_fkey" FOREIGN KEY ("compensationId") REFERENCES "Compensation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementShipment" ADD CONSTRAINT "ReplacementShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplacementShipment" ADD CONSTRAINT "ReplacementShipment_compensationId_fkey" FOREIGN KEY ("compensationId") REFERENCES "Compensation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTimerPause" ADD CONSTRAINT "OrderTimerPause_timerId_fkey" FOREIGN KEY ("timerId") REFERENCES "OrderTimer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve legacy reference-price discounts; actual discount and attribution remain unknown.
ALTER TABLE "ShopOrder" ADD CONSTRAINT "sales_data_kind" CHECK ("dataKind" IN ('REAL','TEST','UNKNOWN'));
ALTER TABLE "OrderRefund" ADD CONSTRAINT "refund_positive" CHECK ("amountCents">0);
ALTER TABLE "Compensation" ADD CONSTRAINT "comp_amount_valid" CHECK ("amountCents">=0 AND "version">0);
ALTER TABLE "OrderTimerPause" ADD CONSTRAINT "pause_finite" CHECK ("endsAt">"startsAt" AND "endsAt" <= "startsAt" + interval '14 days');
ALTER TABLE "OrderRefund" ADD CONSTRAINT "refund_cash_fk" FOREIGN KEY ("cashId") REFERENCES "CashRecord"("id") ON DELETE RESTRICT;
ALTER TABLE "Compensation" ADD CONSTRAINT "comp_expense_fk" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT;
ALTER TABLE "OrderTimer" ADD CONSTRAINT "timer_order_fk" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT;
ALTER TABLE "AftercareCase" ADD CONSTRAINT "case_line_fk" FOREIGN KEY ("lineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT;
ALTER TABLE "AftercareCase" ADD CONSTRAINT "case_parcel_fk" FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE RESTRICT;
ALTER TABLE "ReplacementShipment" ADD CONSTRAINT "replacement_parcel_fk" FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE RESTRICT;
REVOKE UPDATE, DELETE ON "OrderEvent","OrderRefund","OrderTimeoutRule","OrderTimerPause" FROM forme_app;
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['OrderEvent','AftercareCase','Compensation','OrderRefund','ReplacementShipment','OrderTimeoutRule','OrderTimerPause'] LOOP
EXECUTE format('CREATE TRIGGER notification_dirty AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forme_notification_dirty()', t);
END LOOP; END $$;
