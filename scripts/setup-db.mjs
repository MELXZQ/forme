import pg from "pg";
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const admin = new pg.Client({
  host: path.resolve(".local/postgres/socket"),
  port: 55432,
  user: "forme_bootstrap",
  database: "postgres",
});
await admin.connect();
const roles = await admin.query(
  "SELECT rolname FROM pg_roles WHERE rolname IN ('forme_app','forme_migrator')",
);
if (!existsSync(".env.local")) {
  if (roles.rowCount)
    throw new Error(
      "Existing FORME roles found. Restore your .env.local backup; credentials will not be overwritten.",
    );
  const app = randomBytes(32).toString("hex"),
    migrator = randomBytes(32).toString("hex");
  await admin.query(
    `CREATE ROLE forme_migrator LOGIN PASSWORD '${migrator}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
  );
  await admin.query(
    `CREATE ROLE forme_app LOGIN PASSWORD '${app}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
  );
  writeFileSync(
    ".env.local",
    `DATABASE_URL=postgresql://forme_app:${app}@127.0.0.1:55432/forme_dev\nDIRECT_URL=postgresql://forme_migrator:${migrator}@127.0.0.1:55432/forme_dev\nSHADOW_DATABASE_URL=postgresql://forme_migrator:${migrator}@127.0.0.1:55432/forme_shadow\nBETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}\nBETTER_AUTH_URL=http://127.0.0.1:3000\nSTORAGE_DIR=.local/uploads\nPOSTGRES_BIN=/opt/homebrew/opt/postgresql@17/bin\nENABLE_OPERATIONS=true\nENABLE_DEV_PAYMENTS=false\n`,
    { mode: 0o600, flag: "wx" },
  );
} else if (roles.rowCount !== 2)
  throw new Error(
    "Environment file exists but database roles are missing. Refusing to overwrite credentials.",
  );
for (const name of ["forme_dev", "forme_shadow"]) {
  if (
    !(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]))
      .rowCount
  )
    await admin.query(`CREATE DATABASE ${name} OWNER forme_migrator`);
}
await admin.end();
const db = new pg.Client({
  host: path.resolve(".local/postgres/socket"),
  port: 55432,
  user: "forme_bootstrap",
  database: "forme_dev",
});
await db.connect();
await db.query("REVOKE CONNECT ON DATABASE forme_dev FROM PUBLIC");
await db.query(
  "GRANT CONNECT ON DATABASE forme_dev TO forme_app, forme_migrator",
);
await db.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
await db.query("GRANT USAGE ON SCHEMA public TO forme_app");
await db.query(
  "ALTER DEFAULT PRIVILEGES FOR ROLE forme_migrator IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO forme_app",
);
await db.query(
  "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO forme_app",
);
await db.query(
  `DO $$ BEGIN IF to_regclass('public._prisma_migrations') IS NOT NULL THEN REVOKE ALL ON TABLE public._prisma_migrations FROM forme_app; END IF; END $$`,
);
await db.query(
  `DO $$ DECLARE n text; BEGIN FOREACH n IN ARRAY ARRAY['InventoryLedger','AuditLog','OperationCommand','TransferReceipt','TransferReceiptLine','ReceiptAttachment','OrderLine','PaymentEvent','OrderReturn','NotificationRevision','NotificationReceipt','NotificationHistory','NotificationJobRun','CashRecord','PurchaseReceipt','PurchaseReceiptLine','SupplierReturn','SupplierReturnLine','ParcelEvent'] LOOP IF to_regclass(format('public.%I',n)) IS NOT NULL THEN EXECUTE format('REVOKE UPDATE, DELETE ON TABLE public.%I FROM forme_app',n); END IF; END LOOP; END $$`,
);
await db.end();
console.log(
  "Dedicated FORME databases and non-superuser application role are ready. Credentials saved privately in .env.local.",
);
