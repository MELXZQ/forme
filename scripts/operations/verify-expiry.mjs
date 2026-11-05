import { config } from "dotenv";
import pg from "pg";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
config({ path: ".local/operations-test.env", quiet: true });
assert.equal(
  new URL(process.env.DATABASE_URL).pathname,
  "/forme_operations_test",
);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
try {
  const marker = await c.query(
    "SELECT shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()",
  );
  assert.equal(
    marker.rows[0].marker,
    "FORME disposable operations test database",
  );
  const before = await c.query(
    'UPDATE "ShopOrder" SET "expiresAt"=$1::timestamp WHERE "paymentStatus"=\'PENDING\' RETURNING id',
    [new Date(Date.now() - 60000).toISOString()],
  );
  assert.ok(before.rowCount > 0, "Need a synthetic pending order");
  for (let i = 0; i < 2; i++)
    execFileSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "scripts/operations/expire.ts",
      ],
      { env: process.env, stdio: "inherit" },
    );
  const after = await c.query(
    'SELECT count(*)::int n FROM "StockReservation" WHERE "orderId"=ANY($1::text[]) AND status=\'ACTIVE\'',
    [before.rows.map((r) => r.id)],
  );
  assert.equal(after.rows[0].n, 0);
  console.log(
    "PASS: Actual expiry command released synthetic pending orders; repeating it released zero.",
  );
} finally {
  await c.end();
}
