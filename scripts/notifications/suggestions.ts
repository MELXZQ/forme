import assert from "node:assert/strict";
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
async function main() {
  config({ path: ".local/operations-test.env", quiet: true });
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/forme_operations_test",
  );
  const { database } = await import("../../src/server/db");
  const { stockPreview, saveStockPolicies } =
    await import("../../src/server/notifications/rules");
  const { runNotificationCheck } =
    await import("../../src/server/notifications/engine");
  const { applyStockAction } =
    await import("../../src/server/operations/inventory");
  const { createTransfer, dispatchTransfer, receiveTransfer } =
    await import("../../src/server/operations/transfers");
  const db = database();
  try {
    const qa = JSON.parse(await readFile(".local/operations-qa.json", "utf8"));
    const actor = { id: qa.ownerId, role: "admin" as const },
      variantId = qa.skuIds[5],
      reason = "Synthetic replenishment suggestion check",
      key = () => randomUUID();
    const qty = async (warehouse: "BEIJING" | "MELBOURNE") => {
      const b = await db.inventoryBalance.findUniqueOrThrow({
        where: { variantId_warehouse: { variantId, warehouse } },
      });
      return b.onHand - b.reserved - b.unavailable;
    };
    const change = (warehouse: string, kind: string, quantity: number) =>
      applyStockAction(actor, {
        key: key(),
        reason,
        variantId,
        warehouse,
        kind,
        quantity,
      });
    await change("BEIJING", "PURCHASE", 10);
    const scope = await stockPreview(actor, {
      warehouse: "MELBOURNE",
      ids: [variantId],
    });
    const set = async (threshold: number) =>
      saveStockPolicies(actor, {
        key: key(),
        reason,
        warehouse: "MELBOURNE",
        mode: "CUSTOM",
        threshold,
        ids: scope.ids,
        expectedCount: scope.count,
        previewHash: scope.hash,
      });
    const issue = () =>
      db.notification.findFirstOrThrow({
        where: {
          issueKey: `stock:MELBOURNE:${variantId}`,
          conditionActive: true,
        },
      });
    const mel = await qty("MELBOURNE");
    await set(mel + 2);
    await runNotificationCheck(undefined, true);
    assert.ok((await issue()).action.includes("Create or review"));
    const eta = new Date(Date.now() + 5 * 86400000).toISOString();
    const t = await createTransfer(actor, {
      key: key(),
      etaStart: eta,
      etaEnd: eta,
      lines: [{ variantId, planned: 3 }],
    });
    const line = await db.transferLine.findFirstOrThrow({
      where: { transferId: t.id },
    });
    await dispatchTransfer(actor, t.id, {
      key: key(),
      reason,
      dispatchedAt: new Date().toISOString(),
      lines: [{ lineId: line.id, quantity: 3 }],
    });
    await runNotificationCheck(undefined, true);
    assert.ok((await issue()).action.includes("Follow the existing incoming"));
    await receiveTransfer(actor, t.id, {
      key: key(),
      reason,
      lines: [{ lineId: line.id, sellable: 3, unavailable: 0, lost: 0 }],
    });
    await set(await qty("MELBOURNE"));
    await change("BEIJING", "DAMAGE", await qty("BEIJING"));
    await runNotificationCheck(undefined, true);
    assert.ok((await issue()).action.includes("Contact the supplier"));
    await change("MELBOURNE", "DAMAGE", await qty("MELBOURNE"));
    await runNotificationCheck(undefined, true);
    assert.equal((await issue()).severity, 2);
    const bj = await stockPreview(actor, {
      warehouse: "BEIJING",
      ids: [variantId],
    });
    await saveStockPolicies(actor, {
      key: key(),
      reason,
      warehouse: "BEIJING",
      mode: "CUSTOM",
      threshold: 0,
      ids: bj.ids,
      expectedCount: bj.count,
      previewHash: bj.hash,
    });
    await runNotificationCheck(undefined, true);
    const b = await db.notification.findFirstOrThrow({
      where: { issueKey: `stock:BEIJING:${variantId}`, conditionActive: true },
    });
    assert.ok(b.action.includes("Contact the supplier to replenish Beijing"));
    console.log(
      "PASS: Beijing supply / sufficient inbound / no source / complete stockout / Beijing-only recommendations use real quantities and transition on one active issue.",
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error("Suggestion verification failed; private data not printed.");
  process.exitCode = 1;
});
