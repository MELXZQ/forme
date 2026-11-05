import pg from "pg";
import path from "node:path";
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
config({ path: ".env.local", quiet: true });
const name = "forme_operations_test",
  marker = "FORME disposable operations test database";
const maintenance = new pg.Client({
  host: path.resolve(".local/postgres/socket"),
  port: 55432,
  user: "forme_bootstrap",
  database: "postgres",
});
await maintenance.connect();
try {
  const existing = await maintenance.query(
    "SELECT shobj_description(oid,'pg_database') AS description FROM pg_database WHERE datname=$1",
    [name],
  );
  if (existing.rowCount && existing.rows[0].description !== marker)
    throw new Error(
      "The test database name is already in use; refusing to modify it.",
    );
  if (!existing.rowCount) {
    await maintenance.query(`CREATE DATABASE ${name} OWNER forme_migrator`);
    await maintenance.query(`COMMENT ON DATABASE ${name} IS '${marker}'`);
  }
} finally {
  await maintenance.end();
}
const isolated = new pg.Client({
  host: path.resolve(".local/postgres/socket"),
  port: 55432,
  user: "forme_bootstrap",
  database: name,
});
await isolated.connect();
await isolated.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
await isolated.query("GRANT USAGE ON SCHEMA public TO forme_app");
await isolated.query(
  "ALTER DEFAULT PRIVILEGES FOR ROLE forme_migrator IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO forme_app",
);
await isolated.end();
const url = new URL(process.env.DIRECT_URL);
url.pathname = "/" + name;
execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  {
    env: { ...process.env, DIRECT_URL: url.href },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
console.log(
  "Isolated operations test database prepared. The development database was not migrated or reset.",
);
