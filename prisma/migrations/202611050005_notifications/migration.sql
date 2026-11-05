-- CreateTable
CREATE TABLE "NotificationRuleSettings" (
    "id" TEXT NOT NULL DEFAULT 'notifications',
    "version" INTEGER NOT NULL DEFAULT 1,
    "beijingThreshold" INTEGER,
    "melbourneThreshold" INTEGER,
    "productEnabled" BOOLEAN NOT NULL DEFAULT false,
    "productNewDefault" BOOLEAN NOT NULL DEFAULT false,
    "productExistingSince" TIMESTAMP(3),
    "overdueGraceDays" INTEGER NOT NULL DEFAULT 0,
    "autoPinOutOfStock" BOOLEAN NOT NULL DEFAULT false,
    "routing" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRuleSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAlertPolicy" (
    "variantId" TEXT NOT NULL,
    "warehouse" "WarehouseCode" NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'INHERIT',
    "threshold" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockAlertPolicy_pkey" PRIMARY KEY ("variantId","warehouse")
);

-- CreateTable
CREATE TABLE "ProductCheckPolicy" (
    "productId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'INHERIT',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCheckPolicy_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Melbourne',

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "issueKey" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "severity" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "warehouse" "WarehouseCode",
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "actionable" BOOLEAN NOT NULL DEFAULT true,
    "conditionActive" BOOLEAN NOT NULL DEFAULT true,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "systemPin" BOOLEAN NOT NULL DEFAULT false,
    "pinReason" TEXT NOT NULL DEFAULT '',
    "assigneeId" TEXT,
    "recipientIds" TEXT[],
    "confirmerIds" TEXT[],
    "initiatorId" TEXT NOT NULL DEFAULT 'system',
    "version" INTEGER NOT NULL DEFAULT 1,
    "fingerprint" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "currentData" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "deadlineAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRevision" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "confirmerIds" TEXT[],
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationReceipt" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationHistory" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationJob" (
    "id" TEXT NOT NULL DEFAULT 'notifications',
    "requested" BIGINT NOT NULL DEFAULT 1,
    "completed" BIGINT NOT NULL DEFAULT 0,
    "lastStartedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NotificationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationJobRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "checked" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NotificationJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_createdAt_id_idx" ON "Notification"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Notification_status_actionable_idx" ON "Notification"("status", "actionable");

-- CreateIndex
CREATE INDEX "Notification_assigneeId_status_idx" ON "Notification"("assigneeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_issueKey_cycle_key" ON "Notification"("issueKey", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRevision_notificationId_version_key" ON "NotificationRevision"("notificationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationReceipt_notificationId_userId_version_kind_key" ON "NotificationReceipt"("notificationId", "userId", "version", "kind");

-- CreateIndex
CREATE INDEX "NotificationHistory_notificationId_createdAt_idx" ON "NotificationHistory"("notificationId", "createdAt");

-- AddForeignKey
ALTER TABLE "NotificationRevision" ADD CONSTRAINT "NotificationRevision_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationReceipt" ADD CONSTRAINT "NotificationReceipt_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationHistory" ADD CONSTRAINT "NotificationHistory_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "StockAlertPolicy" ADD CONSTRAINT "stock_alert_valid" CHECK (mode IN ('INHERIT','CUSTOM','OFF') AND ((mode='CUSTOM' AND threshold IS NOT NULL AND threshold>=0 AND threshold<=1000000) OR (mode<>'CUSTOM' AND threshold IS NULL)));
ALTER TABLE "ProductCheckPolicy" ADD CONSTRAINT "product_check_valid" CHECK (mode IN ('INHERIT','ON','OFF'));
ALTER TABLE "Notification" ADD CONSTRAINT "notification_state_valid" CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','NOT_APPLICABLE') AND severity BETWEEN 0 AND 3 AND version>0 AND cycle>0 AND (NOT pinned OR cardinality("confirmerIds")>0));
ALTER TABLE "NotificationReceipt" ADD CONSTRAINT "notification_receipt_kind" CHECK (kind IN ('READ','ACK'));
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "notification_timezone" CHECK (timezone IN ('Australia/Melbourne','Asia/Shanghai'));
ALTER TABLE "NotificationRuleSettings" ADD CONSTRAINT "notification_rules_valid" CHECK (("beijingThreshold" IS NULL OR "beijingThreshold" BETWEEN 0 AND 1000000) AND ("melbourneThreshold" IS NULL OR "melbourneThreshold" BETWEEN 0 AND 1000000) AND "overdueGraceDays" BETWEEN 0 AND 90);
ALTER TABLE "StockAlertPolicy" ADD FOREIGN KEY ("variantId") REFERENCES "ProductVariant"(id) ON DELETE RESTRICT;
ALTER TABLE "ProductCheckPolicy" ADD FOREIGN KEY ("productId") REFERENCES "Product"(id) ON DELETE RESTRICT;
ALTER TABLE "NotificationReceipt" ADD FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "NotificationPreference" ADD FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX "notification_active_cycle" ON "Notification" ("issueKey") WHERE "conditionActive";
INSERT INTO "StockAlertPolicy" ("variantId",warehouse,mode,threshold,"updatedAt") SELECT "variantId",'MELBOURNE','CUSTOM',"lowStockThreshold",CURRENT_TIMESTAMP FROM "SkuPolicy";
INSERT INTO "NotificationRuleSettings" (id,"updatedAt") VALUES ('notifications',CURRENT_TIMESTAMP);
INSERT INTO "NotificationJob" (id) VALUES ('notifications');
CREATE FUNCTION forme_notification_dirty() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO "NotificationJob" (id,requested,completed,attempts) VALUES ('notifications',1,0,0) ON CONFLICT(id) DO UPDATE SET requested="NotificationJob".requested+1;
 RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['InventoryBalance','Product','ProductVariant','ProductImage','Transfer','TransferLine','TransferReceipt','User','StockAlertPolicy','ProductCheckPolicy','NotificationRuleSettings'] LOOP
 EXECUTE format('CREATE TRIGGER notification_dirty AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forme_notification_dirty()',t);
END LOOP; END $$;
REVOKE UPDATE,DELETE ON "NotificationRevision","NotificationReceipt","NotificationHistory","NotificationJobRun" FROM forme_app;
