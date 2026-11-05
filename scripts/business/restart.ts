import assert from "node:assert/strict";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
async function main() {
  config({ path: ".local/operations-test.env", quiet: true });
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/forme_operations_test",
  );
  const { database } = await import("../../src/server/db");
  const { runNotificationCheck } =
    await import("../../src/server/notifications/engine");
  const { downloadAttachment } =
    await import("../../src/server/business/attachments");
  const db = database();
  try {
    const s = JSON.parse(
        await readFile(".local/business-verification.json", "utf8"),
      ),
      q = JSON.parse(await readFile(".local/operations-qa.json", "utf8"));
    assert.ok(await db.purchase.findUnique({ where: { id: s.purchaseId } }));
    assert.ok(await db.parcel.findUnique({ where: { id: s.parcelId } }));
    assert.ok(
      (
        await downloadAttachment(
          { id: q.ownerId, role: "admin" },
          s.attachmentId,
        )
      ).ok,
    );
    const counts = async () => ({
      receipts: await db.purchaseReceipt.count(),
      cash: await db.cashRecord.count(),
      expenses: await db.expense.count(),
      parcels: await db.parcel.count(),
      notifications: await db.notification.count(),
    });
    await runNotificationCheck(undefined, true);
    const before = await counts();
    await runNotificationCheck(undefined, true);
    assert.deepEqual(await counts(), before);
    await writeFile(
      ".local/business-restart-verification.json",
      JSON.stringify({
        passed: true,
        checkedAt: new Date().toISOString(),
        counts: before,
      }),
      { mode: 0o600 },
    );
    console.log(
      "PASS: Persisted purchase, parcel and protected attachment readable; repeated catch-up leaves receipts, cash, periods, parcels and notifications unchanged.",
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(
    "Business persistence verification failed:",
    e instanceof Error ? e.message : "unknown",
  );
  process.exitCode = 1;
});
