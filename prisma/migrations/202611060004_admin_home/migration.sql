-- Personal presentation settings only; existing timezones and business data are preserved.
ALTER TABLE "NotificationPreference"
  ADD COLUMN "homeVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "homeRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "homeLayout" JSONB;
