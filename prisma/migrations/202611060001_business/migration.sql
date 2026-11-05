-- CreateTable
CREATE TABLE "BusinessGrant" (
    "userId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessGrant_pkey" PRIMARY KEY ("userId","capability")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL DEFAULT '',
    "contactDetails" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "notes" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierSku" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "url" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "SupplierSku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierSnapshot" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "warehouse" "WarehouseCode" NOT NULL DEFAULT 'BEIJING',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "etaStart" DATE,
    "etaEnd" DATE,
    "currency" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "domesticShipping" INTEGER NOT NULL DEFAULT 0,
    "otherFees" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "supplierCode" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL,
    "unitCost" INTEGER NOT NULL,
    "replacementQty" INTEGER NOT NULL DEFAULT 0,
    "receivedSellable" INTEGER NOT NULL DEFAULT 0,
    "receivedUnavailable" INTEGER NOT NULL DEFAULT 0,
    "cancelledQty" INTEGER NOT NULL DEFAULT 0,
    "shortClosedQty" INTEGER NOT NULL DEFAULT 0,
    "returnedQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceipt" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "parcelId" TEXT,
    "reference" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "sellable" INTEGER NOT NULL,
    "unavailable" INTEGER NOT NULL,

    CONSTRAINT "PurchaseReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierReturn" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disposition" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "SupplierReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "sellable" INTEGER NOT NULL,
    "unavailable" INTEGER NOT NULL,

    CONSTRAINT "SupplierReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "supplierId" TEXT,
    "createdBy" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "plannedAt" DATE NOT NULL,
    "dueAt" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "rateMicros" INTEGER,
    "rateDate" DATE,
    "rateSource" TEXT NOT NULL DEFAULT '',
    "reportCurrency" TEXT NOT NULL DEFAULT 'AUD',
    "reportAmount" INTEGER,
    "accountAlias" TEXT NOT NULL DEFAULT '',
    "channel" TEXT NOT NULL DEFAULT '',
    "expectedResult" TEXT NOT NULL,
    "resultDueAt" DATE NOT NULL,
    "verificationMethod" TEXT NOT NULL,
    "resultStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "resultEvidence" TEXT NOT NULL DEFAULT '',
    "resultConfirmedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "paymentMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "tolerance" INTEGER NOT NULL DEFAULT 0,
    "graceDays" INTEGER NOT NULL DEFAULT 0,
    "reminderDays" INTEGER NOT NULL DEFAULT 7,
    "expectedRefund" INTEGER NOT NULL DEFAULT 0,
    "refundDueAt" DATE,
    "notes" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "purchaseId" TEXT,
    "recurringId" TEXT,
    "cycle" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashRecord" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "accountAlias" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "rateMicros" INTEGER,
    "rateDate" DATE,
    "rateSource" TEXT NOT NULL DEFAULT '',
    "reportAmount" INTEGER,
    "correctionOf" TEXT,

    CONSTRAINT "CashRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseLink" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "meaning" TEXT NOT NULL DEFAULT 'INDEPENDENT_FEE',

    CONSTRAINT "ExpenseLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringExpense" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "interval" INTEGER NOT NULL,
    "anchorDate" DATE NOT NULL,
    "nextIndex" INTEGER NOT NULL DEFAULT 0,
    "endDate" DATE,
    "timezone" TEXT NOT NULL,
    "reminderDays" INTEGER NOT NULL DEFAULT 7,
    "graceDays" INTEGER NOT NULL DEFAULT 0,
    "paymentMode" TEXT NOT NULL,
    "expectedResult" TEXT NOT NULL,
    "verificationMethod" TEXT NOT NULL,
    "accountAlias" TEXT NOT NULL DEFAULT '',
    "channel" TEXT NOT NULL DEFAULT '',
    "tolerance" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parcel" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "purchaseId" TEXT,
    "transferId" TEXT,
    "orderId" TEXT,
    "returnId" TEXT,
    "assigneeId" TEXT NOT NULL,
    "sourcePlace" TEXT NOT NULL,
    "destinationPlace" TEXT NOT NULL,
    "warehouse" "WarehouseCode",
    "timezone" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "carrier" TEXT NOT NULL DEFAULT '',
    "trackingNumber" TEXT NOT NULL DEFAULT '',
    "packageCount" INTEGER NOT NULL DEFAULT 1,
    "weightGrams" INTEGER,
    "dispatchedAt" TIMESTAMP(3),
    "etaStart" DATE,
    "etaEnd" DATE,
    "signedAt" TIMESTAMP(3),
    "transportStatus" TEXT NOT NULL DEFAULT 'PREPARING',
    "exception" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Parcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelLine" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "purchaseLineId" TEXT,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ParcelLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelEvent" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,

    CONSTRAINT "ParcelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessAttachment" (
    "id" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE INDEX "SupplierSku_variantId_idx" ON "SupplierSku"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierSku_supplierId_variantId_supplierCode_key" ON "SupplierSku"("supplierId", "variantId", "supplierCode");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_number_key" ON "Purchase"("number");

-- CreateIndex
CREATE INDEX "Purchase_status_etaEnd_idx" ON "Purchase"("status", "etaEnd");

-- CreateIndex
CREATE INDEX "Purchase_supplierId_orderedAt_idx" ON "Purchase"("supplierId", "orderedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseLine_purchaseId_variantId_key" ON "PurchaseLine"("purchaseId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceipt_purchaseId_reference_key" ON "PurchaseReceipt"("purchaseId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceiptLine_receiptId_lineId_key" ON "PurchaseReceiptLine"("receiptId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierReturn_purchaseId_reference_key" ON "SupplierReturn"("purchaseId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierReturnLine_returnId_lineId_key" ON "SupplierReturnLine"("returnId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_number_key" ON "Expense"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_purchaseId_key" ON "Expense"("purchaseId");

-- CreateIndex
CREATE INDEX "Expense_status_dueAt_idx" ON "Expense"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Expense_categoryId_currency_idx" ON "Expense"("categoryId", "currency");

-- CreateIndex
CREATE INDEX "Expense_supplierId_idx" ON "Expense"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_recurringId_cycle_key" ON "Expense"("recurringId", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "CashRecord_correctionOf_key" ON "CashRecord"("correctionOf");

-- CreateIndex
CREATE INDEX "CashRecord_occurredAt_currency_idx" ON "CashRecord"("occurredAt", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "CashRecord_expenseId_reference_kind_key" ON "CashRecord"("expenseId", "reference", "kind");

-- CreateIndex
CREATE INDEX "ExpenseLink_objectType_objectId_idx" ON "ExpenseLink"("objectType", "objectId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseLink_expenseId_objectType_objectId_key" ON "ExpenseLink"("expenseId", "objectType", "objectId");

-- CreateIndex
CREATE UNIQUE INDEX "Parcel_number_key" ON "Parcel"("number");

-- CreateIndex
CREATE INDEX "Parcel_carrier_trackingNumber_idx" ON "Parcel"("carrier", "trackingNumber");

-- CreateIndex
CREATE INDEX "Parcel_type_transportStatus_etaEnd_idx" ON "Parcel"("type", "transportStatus", "etaEnd");

-- CreateIndex
CREATE INDEX "Parcel_transferId_idx" ON "Parcel"("transferId");

-- CreateIndex
CREATE INDEX "Parcel_orderId_idx" ON "Parcel"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ParcelLine_parcelId_variantId_key" ON "ParcelLine"("parcelId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ParcelEvent_parcelId_source_reference_key" ON "ParcelEvent"("parcelId", "source", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessAttachment_key_key" ON "BusinessAttachment"("key");

-- CreateIndex
CREATE INDEX "BusinessAttachment_objectType_objectId_idx" ON "BusinessAttachment"("objectType", "objectId");

-- AddForeignKey
ALTER TABLE "SupplierSku" ADD CONSTRAINT "SupplierSku_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "PurchaseReceiptLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PurchaseLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturn" ADD CONSTRAINT "SupplierReturn_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT "SupplierReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SupplierReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT "SupplierReturnLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "PurchaseLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "RecurringExpense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRecord" ADD CONSTRAINT "CashRecord_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashRecord" ADD CONSTRAINT "CashRecord_correctionOf_fkey" FOREIGN KEY ("correctionOf") REFERENCES "CashRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseLink" ADD CONSTRAINT "ExpenseLink_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Parcel" ADD CONSTRAINT "Parcel_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelLine" ADD CONSTRAINT "ParcelLine_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelLine" ADD CONSTRAINT "ParcelLine_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "PurchaseLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelEvent" ADD CONSTRAINT "ParcelEvent_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "BusinessGrant" ADD CONSTRAINT "BusinessGrant_user_fk" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "SupplierSku" ADD CONSTRAINT "SupplierSku_variant_fk" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT;
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_variant_fk" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT;
ALTER TABLE "ParcelLine" ADD CONSTRAINT "ParcelLine_variant_fk" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_supplier_fk" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT;
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_category_fk" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE RESTRICT;
ALTER TABLE "Parcel" ADD CONSTRAINT "Parcel_transfer_fk" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT;
ALTER TABLE "Parcel" ADD CONSTRAINT "Parcel_order_fk" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT;
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "purchase_quantity_valid" CHECK ("quantity">0 AND "unitCost">=0 AND "replacementQty">=0 AND "receivedSellable">=0 AND "receivedUnavailable">=0 AND "cancelledQty">=0 AND "shortClosedQty">=0 AND "returnedQty">=0 AND "returnedQty" <= "receivedSellable"+"receivedUnavailable" AND "receivedSellable"+"receivedUnavailable"+"cancelledQty"+"shortClosedQty" <= "quantity"+"replacementQty");
ALTER TABLE "Purchase" ADD CONSTRAINT "purchase_total_valid" CHECK ("subtotal">=0 AND "discount">=0 AND "domesticShipping">=0 AND "otherFees">=0 AND "total">=0 AND "total"="subtotal"-"discount"+"domesticShipping"+"otherFees" AND "version">0 AND "status" IN ('DRAFT','CONFIRMED','CLOSED','CANCELLED'));
ALTER TABLE "Expense" ADD CONSTRAINT "expense_amount_valid" CHECK ("amount">=0 AND "tolerance">=0 AND "expectedRefund">=0 AND ("rateMicros" IS NULL OR "rateMicros">0) AND "status" IN ('OPEN','CANCELLED'));
ALTER TABLE "CashRecord" ADD CONSTRAINT "cash_valid" CHECK ("amount">0 AND "kind" IN ('PAYMENT','REFUND','REVERSAL') AND "status" IN ('CONFIRMED','FAILED') AND "source" IN ('MANUAL','TEST') AND ("kind"='REVERSAL')=("correctionOf" IS NOT NULL));
ALTER TABLE "PurchaseReceiptLine" ADD CONSTRAINT "purchase_receipt_valid" CHECK ("sellable">=0 AND "unavailable">=0 AND "sellable"+"unavailable">0);
ALTER TABLE "SupplierReturnLine" ADD CONSTRAINT "supplier_return_valid" CHECK ("sellable">=0 AND "unavailable">=0 AND "sellable"+"unavailable">0);
ALTER TABLE "ParcelLine" ADD CONSTRAINT "parcel_quantity_valid" CHECK ("quantity">0);
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "recurring_valid" CHECK ("interval">0 AND "nextIndex">=0 AND "amount">=0 AND "unit" IN ('DAY','WEEK','MONTH','YEAR') AND "status" IN ('ACTIVE','PAUSED','ENDED'));
INSERT INTO "ExpenseCategory" (id,name) VALUES ('purchase','采购'),('domestic-freight','国内运费'),('international-freight','国际运输'),('au-delivery','澳洲配送'),('packaging','包装'),('software','软件订阅'),('domain','域名'),('marketing','营销'),('other','其他') ON CONFLICT DO NOTHING;
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['Purchase','PurchaseLine','PurchaseReceipt','SupplierReturn','Expense','CashRecord','RecurringExpense','Parcel','ParcelEvent','BusinessGrant'] LOOP
EXECUTE format('CREATE TRIGGER notification_dirty AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forme_notification_dirty()', t);
END LOOP; END $$;
REVOKE UPDATE, DELETE ON "CashRecord","PurchaseReceipt","PurchaseReceiptLine","SupplierReturn","SupplierReturnLine","ParcelEvent" FROM forme_app;
