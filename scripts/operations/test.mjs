import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { promises as fs } from "node:fs";
config({ path: ".env.local", quiet: true });
try {
  execFileSync(process.execPath, ["scripts/operations/prepare-test-db.mjs"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const key of ["DATABASE_URL", "DIRECT_URL", "SHADOW_DATABASE_URL"]) {
    const u = new URL(process.env[key]);
    u.pathname = "/forme_operations_test";
    process.env[key] = u.href;
  }
  const db = new pg.Client({ connectionString: process.env.DIRECT_URL });
  await db.connect();
  try {
    const marker = await db.query(
      "SELECT current_database() AS name, shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()",
    );
    if (
      marker.rows[0].name !== "forme_operations_test" ||
      marker.rows[0].marker !== "FORME disposable operations test database"
    )
      throw new Error("Test database identity check failed.");
    const tables = await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'",
    );
    const identifiers = tables.rows.map(
      (r) => 'public."' + r.tablename.replaceAll('"', '""') + '"',
    );
    if (identifiers.length)
      await db.query(
        `TRUNCATE ${identifiers.join(",")} RESTART IDENTITY CASCADE`,
      );
  } finally {
    await db.end();
  }
  process.env.BETTER_AUTH_URL = "http://127.0.0.1:3002";
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
  process.env.STORAGE_DIR = ".local/operations-test-uploads";
  process.env.ENABLE_DEV_PAYMENTS = "true";
  process.env.ENABLE_OPERATIONS = "true";
  process.env.FORME_TEST_DIST_DIR = ".next-operations-test";
  await fs.mkdir(".local", { recursive: true, mode: 0o700 });
  const envNames = [
    "DATABASE_URL",
    "DIRECT_URL",
    "SHADOW_DATABASE_URL",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "STORAGE_DIR",
    "ENABLE_DEV_PAYMENTS",
    "ENABLE_OPERATIONS",
    "FORME_TEST_DIST_DIR",
  ];
  await fs.writeFile(
    ".local/operations-test.env",
    envNames.map((k) => `${k}=${process.env[k]}`).join("\n") + "\n",
    { mode: 0o600 },
  );
  execFileSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "prisma/seed.ts"],
    { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  process.env.NODE_ENV = "test";
  await import("./integration.ts");
} catch {
  console.error(
    "Operations verification setup failed. The development database was not reset; credentials were not printed.",
  );
  process.exitCode = 1;
}
