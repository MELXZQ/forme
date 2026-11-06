-- Snapshot membership predicates use containment; no indexes on speculative dimensions.
CREATE INDEX "OrderLine_collections_gin" ON "OrderLine" USING GIN ("collections" jsonb_path_ops);
CREATE INDEX "OrderLine_campaigns_gin" ON "OrderLine" USING GIN ("campaigns" jsonb_path_ops);
CREATE INDEX "AftercareCase_open_due" ON "AftercareCase" ("dueAt") WHERE "status" NOT IN ('CLOSED','RESOLVED');
