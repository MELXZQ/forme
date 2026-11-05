-- Runtime application access excludes Prisma's migration ledger.
-- The migrator owns this table and retains access for future migrations.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'forme_app') THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM forme_app;
  END IF;
END $$;
