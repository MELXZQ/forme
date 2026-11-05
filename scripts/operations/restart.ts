import assert from "node:assert/strict";
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
async function main() {
  config({ path: ".local/operations-test.env", quiet: true });
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/forme_operations_test",
  );
  const { database } = await import("../../src/server/db");
  const { readableMedia } = await import("../../src/server/media");
  const db = database();
  try {
    const state = JSON.parse(
      await readFile(".local/operations-verification.json", "utf8"),
    );
    assert.ok(await db.shopOrder.findUnique({ where: { id: state.orderId } }));
    assert.ok(await db.product.findUnique({ where: { id: state.productId } }));
    assert.ok(await db.inventoryLedger.count());
    assert.ok((await readableMedia(state.mediaId, true)).bytes.length);
    console.log(
      "PASS: Existing isolated order, product, inventory history and uploaded image persisted; no data changed.",
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error("Persistence check failed; configuration was not printed.");
  process.exitCode = 1;
});
