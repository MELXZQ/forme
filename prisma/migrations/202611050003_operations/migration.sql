-- CreateEnum
CREATE TYPE "WarehouseCode" AS ENUM ('BEIJING', 'MELBOURNE');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIAL', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REVIEW');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('UNFULFILLED', 'SHIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "warehouse" "WarehouseCode" NOT NULL,
    "onHand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "unavailable" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyStock" (
    "variantId" TEXT NOT NULL,
    "originalQty" INTEGER NOT NULL,
    "remainingQty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyStock_pkey" PRIMARY KEY ("variantId")
);

-- CreateTable
CREATE TABLE "SkuPolicy" (
    "variantId" TEXT NOT NULL,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 3,
    "showRestocking" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SkuPolicy_pkey" PRIMARY KEY ("variantId")
);

-- CreateTable
CREATE TABLE "InventoryLedger" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "warehouse" "WarehouseCode" NOT NULL,
    "kind" TEXT NOT NULL,
    "deltaOnHand" INTEGER NOT NULL,
    "deltaReserved" INTEGER NOT NULL,
    "deltaUnavailable" INTEGER NOT NULL,
    "deltaInTransit" INTEGER NOT NULL DEFAULT 0,
    "beforeOnHand" INTEGER NOT NULL,
    "beforeReserved" INTEGER NOT NULL,
    "beforeUnavailable" INTEGER NOT NULL,
    "afterOnHand" INTEGER NOT NULL,
    "afterReserved" INTEGER NOT NULL,
    "afterUnavailable" INTEGER NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationCommand" (
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "actorId" TEXT,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationCommand_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "source" "WarehouseCode" NOT NULL DEFAULT 'BEIJING',
    "destination" "WarehouseCode" NOT NULL DEFAULT 'MELBOURNE',
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "carrier" TEXT NOT NULL DEFAULT '',
    "trackingNumber" TEXT NOT NULL DEFAULT '',
    "dispatchedAt" TIMESTAMP(3),
    "etaStart" TIMESTAMP(3),
    "etaEnd" TIMESTAMP(3),
    "exception" BOOLEAN NOT NULL DEFAULT false,
    "showRestocking" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferLine" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "planned" INTEGER NOT NULL,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "receivedSellable" INTEGER NOT NULL DEFAULT 0,
    "receivedUnavailable" INTEGER NOT NULL DEFAULT 0,
    "lost" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferReceipt" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "transferLineId" TEXT NOT NULL,
    "sellable" INTEGER NOT NULL,
    "unavailable" INTEGER NOT NULL,
    "lost" INTEGER NOT NULL,

    CONSTRAINT "TransferReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptAttachment" (
    "receiptId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "ReceiptAttachment_pkey" PRIMARY KEY ("receiptId","mediaId")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "warehouse" "WarehouseCode" NOT NULL,
    "countedOnHand" INTEGER NOT NULL,
    "expectedOnHand" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceSettings" (
    "id" TEXT NOT NULL DEFAULT 'commerce',
    "shippingCents" INTEGER,
    "reservationMinutes" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'AU',
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "subtotalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "shippingCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "recordedRefundCents" INTEGER NOT NULL DEFAULT 0,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "fulfillmentStatus" "FulfillmentStatus" NOT NULL DEFAULT 'UNFULFILLED',
    "carrier" TEXT NOT NULL DEFAULT '',
    "trackingNumber" TEXT NOT NULL DEFAULT '',
    "exception" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "collections" JSONB NOT NULL,
    "imageMediaId" TEXT,
    "quantity" INTEGER NOT NULL,
    "originalUnitCents" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "discountSource" TEXT NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAccess" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderReturn" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "sellable" INTEGER NOT NULL,
    "unavailable" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_variantId_warehouse_key" ON "InventoryBalance"("variantId", "warehouse");

-- CreateIndex
CREATE INDEX "InventoryLedger_variantId_warehouse_createdAt_idx" ON "InventoryLedger"("variantId", "warehouse", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryLedger_documentType_documentId_idx" ON "InventoryLedger"("documentType", "documentId");

-- CreateIndex
CREATE INDEX "AuditLog_objectType_objectId_createdAt_idx" ON "AuditLog"("objectType", "objectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_number_key" ON "Transfer"("number");

-- CreateIndex
CREATE INDEX "Transfer_status_etaEnd_idx" ON "Transfer"("status", "etaEnd");

-- CreateIndex
CREATE UNIQUE INDEX "TransferLine_transferId_variantId_key" ON "TransferLine"("transferId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrder_number_key" ON "ShopOrder"("number");

-- CreateIndex
CREATE INDEX "ShopOrder_paymentStatus_expiresAt_idx" ON "ShopOrder"("paymentStatus", "expiresAt");

-- CreateIndex
CREATE INDEX "ShopOrder_createdAt_idx" ON "ShopOrder"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLine_orderId_variantId_key" ON "OrderLine"("orderId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockReservation_orderId_variantId_key" ON "StockReservation"("orderId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderAccess_tokenHash_key" ON "OrderAccess"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_eventId_key" ON "PaymentEvent"("eventId");

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyStock" ADD CONSTRAINT "LegacyStock_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuPolicy" ADD CONSTRAINT "SkuPolicy_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferReceipt" ADD CONSTRAINT "TransferReceipt_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferReceiptLine" ADD CONSTRAINT "TransferReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "TransferReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferReceiptLine" ADD CONSTRAINT "TransferReceiptLine_transferLineId_fkey" FOREIGN KEY ("transferLineId") REFERENCES "TransferLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAttachment" ADD CONSTRAINT "ReceiptAttachment_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "TransferReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAttachment" ADD CONSTRAINT "ReceiptAttachment_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_imageMediaId_fkey" FOREIGN KEY ("imageMediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAccess" ADD CONSTRAINT "OrderAccess_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderReturn" ADD CONSTRAINT "OrderReturn_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep old values as an unassigned snapshot. Never infer a warehouse.
INSERT INTO "LegacyStock" ("variantId", "originalQty", "remainingQty")
SELECT id, stock, stock FROM "ProductVariant" WHERE stock > 0
ON CONFLICT ("variantId") DO NOTHING;

ALTER TABLE "InventoryBalance" ADD CONSTRAINT "balance_valid" CHECK (
 "onHand" BETWEEN 0 AND 1000000 AND reserved >= 0 AND unavailable >= 0
 AND reserved::bigint + unavailable <= "onHand");
ALTER TABLE "LegacyStock" ADD CONSTRAINT "legacy_valid" CHECK ("originalQty" >= 0 AND "remainingQty" BETWEEN 0 AND "originalQty");
ALTER TABLE "SkuPolicy" ADD CONSTRAINT "policy_valid" CHECK ("lowStockThreshold" BETWEEN 0 AND 1000000);
ALTER TABLE "Transfer" ADD CONSTRAINT "transfer_route_valid" CHECK (source = 'BEIJING' AND destination = 'MELBOURNE');
ALTER TABLE "Transfer" ADD CONSTRAINT "transfer_eta_valid" CHECK ("etaStart" IS NULL OR "etaEnd" IS NULL OR "etaStart" <= "etaEnd");
ALTER TABLE "TransferLine" ADD CONSTRAINT "transfer_quantity_valid" CHECK (planned > 0 AND sent BETWEEN 0 AND planned AND "receivedSellable" >= 0 AND "receivedUnavailable" >= 0 AND lost >= 0 AND "receivedSellable"::bigint + "receivedUnavailable" + lost <= sent);
ALTER TABLE "TransferReceiptLine" ADD CONSTRAINT "receipt_quantity_valid" CHECK (sellable >= 0 AND unavailable >= 0 AND lost >= 0 AND sellable::bigint + unavailable + lost > 0);
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "count_valid" CHECK ("countedOnHand" BETWEEN 0 AND 1000000 AND "expectedOnHand" BETWEEN 0 AND 1000000 AND status IN ('PENDING','APPROVED','REJECTED'));
ALTER TABLE "CommerceSettings" ADD CONSTRAINT "commerce_valid" CHECK ("reservationMinutes" BETWEEN 1 AND 1440 AND ("shippingCents" IS NULL OR "shippingCents" BETWEEN 0 AND 100000));
ALTER TABLE "ShopOrder" ADD CONSTRAINT "order_amount_valid" CHECK (currency = 'AUD' AND country = 'AU' AND "subtotalCents" > 0 AND "discountCents" >= 0 AND "shippingCents" >= 0 AND "totalCents"::bigint = "subtotalCents"::bigint + "shippingCents" AND "recordedRefundCents" BETWEEN 0 AND "totalCents");
ALTER TABLE "OrderLine" ADD CONSTRAINT "order_line_valid" CHECK (quantity BETWEEN 1 AND 99 AND "unitPriceCents" > 0 AND "originalUnitCents" >= "unitPriceCents" AND "lineTotalCents"::bigint = "unitPriceCents"::bigint * quantity AND "discountCents"::bigint = ("originalUnitCents"::bigint - "unitPriceCents") * quantity AND "discountSource" IN ('NONE','MARKDOWN'));
ALTER TABLE "StockReservation" ADD CONSTRAINT "reservation_valid" CHECK (quantity BETWEEN 1 AND 99 AND ((status = 'ACTIVE' AND "resolvedAt" IS NULL) OR (status <> 'ACTIVE' AND "resolvedAt" IS NOT NULL)));
ALTER TABLE "OrderReturn" ADD CONSTRAINT "return_quantity_valid" CHECK (sellable >= 0 AND unavailable >= 0 AND sellable::bigint + unavailable > 0);
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "ledger_balance_valid" CHECK (
 "afterOnHand"::bigint = "beforeOnHand"::bigint + "deltaOnHand" AND
 "afterReserved"::bigint = "beforeReserved"::bigint + "deltaReserved" AND
 "afterUnavailable"::bigint = "beforeUnavailable"::bigint + "deltaUnavailable" AND
 "beforeOnHand" >= 0 AND "beforeReserved" >= 0 AND "beforeUnavailable" >= 0 AND
 "afterOnHand" >= 0 AND "afterReserved" >= 0 AND "afterUnavailable" >= 0 AND
 "beforeReserved"::bigint + "beforeUnavailable" <= "beforeOnHand" AND
 "afterReserved"::bigint + "afterUnavailable" <= "afterOnHand");

-- Immutable operational history: runtime credentials can append and read only.
DO $$
DECLARE table_name text;
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'forme_app') THEN
  FOREACH table_name IN ARRAY ARRAY['InventoryLedger','AuditLog','OperationCommand','TransferReceipt','TransferReceiptLine','ReceiptAttachment','OrderLine','PaymentEvent','OrderReturn'] LOOP
   EXECUTE format('REVOKE UPDATE, DELETE ON TABLE public.%I FROM forme_app', table_name);
  END LOOP;
 END IF;
END $$;
