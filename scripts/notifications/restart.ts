import assert from "node:assert/strict";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
async function main() {
  config({ path: ".local/operations-test.env", quiet: true });
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/forme_operations_test",
  );
  const { database } = await import("../../src/server/db");
  const { runNotificationCheck } =
    await import("../../src/server/notifications/engine");
  const db = database();
  try {
    if (process.argv[2] === "prepare") {
      await runNotificationCheck(undefined, true);
      const counts = {
        notifications: await db.notification.count(),
        receipts: await db.notificationReceipt.count(),
        revisions: await db.notificationRevision.count(),
      };
      const p = await db.product.findUniqueOrThrow({
        where: { id: "ops-product" },
      });
      await db.product.update({
        where: { id: p.id },
        data: { description: p.description },
      });
      const job = await db.notificationJob.findUniqueOrThrow({
        where: { id: "notifications" },
      });
      assert.ok(job.requested > job.completed);
      await writeFile(
        ".local/notification-restart.json",
        JSON.stringify(counts),
        { mode: 0o600 },
      );
      console.log("PASS: Pending change durably queued before restart.");
    } else {
      const before = JSON.parse(
        await readFile(".local/notification-restart.json", "utf8"),
      );
      assert.equal(await db.notification.count(), before.notifications);
      assert.equal(await db.notificationReceipt.count(), before.receipts);
      execFileSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "scripts/notifications/check.ts",
        ],
        { env: process.env, stdio: "pipe" },
      );
      const job = await db.notificationJob.findUniqueOrThrow({
        where: { id: "notifications" },
      });
      assert.equal(job.requested, job.completed);
      assert.equal(await db.notification.count(), before.notifications);
      assert.equal(await db.notificationRevision.count(), before.revisions);
      assert.equal(job.lastError, null);
      console.log(
        "PASS: After database/application restart, a fresh task process caught up pending work without duplicating notifications or resetting confirmations.",
      );
    }
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    "Notification persistence verification failed; credentials not printed.",
  );
  process.exitCode = 1;
});
