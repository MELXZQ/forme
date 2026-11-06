import assert from "node:assert/strict";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
async function main() {
  config({ path: ".local/operations-test.env", quiet: true });
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/forme_operations_test",
  );
  const { database } = await import("../../src/server/db"),
    db = database();
  try {
    const s = JSON.parse(
        await readFile(".local/sales-verification.json", "utf8"),
      ),
      qa = JSON.parse(await readFile(".local/operations-qa.json", "utf8"));
    const { runNotificationCheck } =
        await import("../../src/server/notifications/engine"),
      { downloadAttachment } =
        await import("../../src/server/business/attachments");
    assert.ok(
      await db.compensation.findUnique({ where: { id: s.compensationId } }),
    );
    assert.ok(
      (
        await downloadAttachment(
          { id: qa.ownerId, role: "admin" },
          s.attachmentId,
        )
      ).ok,
    );
    const count = async () => ({
      refunds: await db.orderRefund.count(),
      events: await db.orderEvent.count(),
      replacements: await db.replacementShipment.count(),
      cash: await db.cashRecord.count(),
      notifications: await db.notification.count(),
    });
    await runNotificationCheck(undefined, true);
    const before = await count();
    await runNotificationCheck(undefined, true);
    assert.deepEqual(await count(), before);
    await writeFile(
      ".local/sales-restart-verification.json",
      JSON.stringify({ passed: true, counts: before }),
      { mode: 0o600 },
    );
    console.log(
      "PASS: Order events, compensation, refunds and private evidence persist; repeated catch-up creates no duplicate cash, stock fulfillment or notifications.",
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Sales restart verification failed; credentials were not printed",
  );
  process.exitCode = 1;
});
