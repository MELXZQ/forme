import assert from "node:assert/strict";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
async function main() {
  config({ path: ".local/operations-test.env", quiet: true });
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/forme_operations_test",
  );
  const { database } = await import("../../src/server/db");
  const db = database();
  const { runNotificationCheck } =
    await import("../../src/server/notifications/engine");
  const { actNotification, listNotifications, notificationDetail } =
    await import("../../src/server/notifications/service");
  const { saveRules, stockPreview, saveStockPolicies, saveProductPolicies } =
    await import("../../src/server/notifications/rules");
  const { createAccount, updateAccount } =
    await import("../../src/server/operations/accounts");
  const { applyStockAction } =
    await import("../../src/server/operations/inventory");
  const { dateBounds, localDay } =
    await import("../../src/server/notifications/time");
  const qa = JSON.parse(await readFile(".local/operations-qa.json", "utf8"));
  const owner = { id: qa.ownerId, role: "admin" as const },
    keeper = { id: qa.warehouseId, role: "warehouse" as const };
  const reason = "Synthetic notification acceptance check";
  const key = () => randomUUID();
  const checks: string[] = [];
  const pass = (m: string) => {
    checks.push(m);
    console.log("PASS: " + m);
  };
  const bad = async (fn: () => Promise<unknown>, status: number) =>
    assert.rejects(
      fn,
      (e) =>
        !!e && typeof e === "object" && "status" in e && e.status === status,
    );
  try {
    const dst = dateBounds("2026-10-04", "Australia/Melbourne");
    assert.equal(dst.lt.getTime() - dst.gte.getTime(), 23 * 3600000);
    const winter = dateBounds("2026-04-05", "Australia/Melbourne");
    assert.equal(winter.lt.getTime() - winter.gte.getTime(), 25 * 3600000);
    assert.equal(
      localDay(new Date("2026-01-01T14:00:00Z"), "Australia/Melbourne"),
      "2026-01-02",
    );
    assert.equal(
      localDay(new Date("2026-01-01T14:00:00Z"), "Asia/Shanghai"),
      "2026-01-01",
    );
    pass(
      "Melbourne DST produces 23/25-hour dates; Beijing and Melbourne cross-day boundaries differ correctly.",
    );
    const other = await createAccount(owner, {
      key: key(),
      reason,
      name: "Synthetic second owner",
      email: `notifications-${key()}@verification.invalid`,
      password: key() + key(),
      role: "admin",
    });
    const owner2 = { id: other.id, role: "admin" as const };
    const route = {
      assigneeId: owner.id,
      recipientIds: [owner.id, owner2.id],
      confirmerIds: [owner.id, owner2.id],
    };
    const rule = {
      key: key(),
      reason,
      beijingThreshold: null,
      melbourneThreshold: null,
      productEnabled: false,
      productNewDefault: false,
      productScope: "FUTURE" as const,
      overdueGraceDays: 0,
      autoPinOutOfStock: false,
      routing: {
        INVENTORY: route,
        PRODUCT: route,
        LOGISTICS: {
          ...route,
          recipientIds: [...route.recipientIds, keeper.id],
        },
        SYSTEM: route,
      },
    };
    await saveRules(owner, rule);
    const variantId = qa.skuIds[4];
    const scope = await stockPreview(owner, {
      warehouse: "MELBOURNE",
      ids: [variantId],
    });
    const policy = {
      key: key(),
      reason,
      warehouse: "MELBOURNE",
      mode: "CUSTOM",
      threshold: 4,
      ids: [variantId],
      expectedCount: 1,
      previewHash: scope.hash,
    };
    await bad(() => saveStockPolicies(keeper, policy), 403);
    await bad(
      () => saveStockPolicies(owner, { ...policy, expectedCount: 2 }),
      409,
    );
    await saveStockPolicies(owner, policy);
    await runNotificationCheck(undefined, true);
    const get = () =>
      db.notification.findFirstOrThrow({
        where: {
          issueKey: `stock:MELBOURNE:${variantId}`,
          conditionActive: true,
        },
      });
    let n = await get();
    const initialId = n.id;
    const numBefore = await db.notification.count();
    await Promise.all([
      runNotificationCheck(undefined, true),
      runNotificationCheck(undefined, true),
    ]);
    assert.equal(await db.notification.count(), numBefore);
    assert.equal((await get()).version, n.version);
    const action = (
      actor: typeof owner | typeof keeper,
      id: string,
      version: number,
      action: string,
      extra = {},
    ) =>
      actNotification(actor, id, {
        key: key(),
        reason,
        version,
        action,
        ...extra,
      });
    await action(owner, n.id, n.version, "pin", {
      confirmerIds: [owner.id, owner2.id],
    });
    n = await get();
    await action(owner, n.id, n.version, "read");
    const mine = await listNotifications(owner, {
      view: "all",
      unread: "true",
    });
    assert.ok(!mine.items.some((i) => i.id === n.id));
    const theirs = await listNotifications(owner2, {
      view: "all",
      unread: "true",
    });
    assert.ok(theirs.items.some((i) => i.id === n.id));
    await action(owner, n.id, n.version, "ack");
    await bad(() => action(owner, n.id, n.version, "unpin"), 409);
    await action(owner2, n.id, n.version, "ack");
    await action(owner, n.id, n.version, "unpin");
    await bad(() => notificationDetail(keeper, n.id), 404);
    pass(
      "Read and confirmation are per person; two designated confirmations are required; unauthorized warehouse access and stale batch scope are rejected.",
    );
    await applyStockAction(owner, {
      key: key(),
      reason,
      variantId,
      warehouse: "MELBOURNE",
      kind: "DAMAGE",
      quantity: 1,
    });
    await runNotificationCheck(undefined, true);
    const revised = await get();
    assert.equal(revised.version, n.version + 1);
    await bad(() => action(owner, revised.id, n.version, "ack"), 409);
    assert.ok(
      !(
        await db.notificationReceipt.findMany({
          where: {
            notificationId: n.id,
            version: revised.version,
            kind: "ACK",
          },
        })
      ).length,
    );
    n = revised;
    await action(owner, n.id, n.version, "dismiss");
    await runNotificationCheck(undefined, true);
    assert.equal((await get()).id, n.id);
    assert.equal((await get()).status, "NOT_APPLICABLE");
    await applyStockAction(owner, {
      key: key(),
      reason,
      variantId,
      warehouse: "MELBOURNE",
      kind: "PURCHASE",
      quantity: 10,
    });
    await runNotificationCheck(undefined, true);
    assert.equal(
      (await db.notification.findUniqueOrThrow({ where: { id: initialId } }))
        .conditionActive,
      false,
    );
    await applyStockAction(owner, {
      key: key(),
      reason,
      variantId,
      warehouse: "MELBOURNE",
      kind: "DAMAGE",
      quantity: 10,
    });
    await runNotificationCheck(undefined, true);
    assert.notEqual((await get()).id, initialId);
    pass(
      "Material changes require a new confirmation version; refresh preserves confirmations; dismissal suppresses the current cycle; recovery and relapse create a new historical cycle.",
    );
    await saveRules(owner, { ...rule, key: key(), melbourneThreshold: 10 });
    assert.equal(
      (
        await db.stockAlertPolicy.findUniqueOrThrow({
          where: { variantId_warehouse: { variantId, warehouse: "MELBOURNE" } },
        })
      ).threshold,
      4,
    );
    const zero = await stockPreview(owner, {
      warehouse: "BEIJING",
      ids: [qa.skuIds[0]],
    });
    await saveStockPolicies(owner, {
      key: key(),
      reason,
      warehouse: "BEIJING",
      mode: "CUSTOM",
      threshold: 0,
      ids: zero.ids,
      expectedCount: zero.count,
      previewHash: zero.hash,
    });
    await runNotificationCheck(undefined, true);
    assert.ok(
      await db.notification.findFirst({
        where: {
          issueKey: `stock:BEIJING:${qa.skuIds[0]}`,
          conditionActive: true,
        },
      }),
    );
    await saveStockPolicies(owner, {
      key: key(),
      reason,
      warehouse: "BEIJING",
      mode: "OFF",
      threshold: null,
      ids: zero.ids,
      expectedCount: zero.count,
      previewHash: zero.hash,
    });
    await runNotificationCheck(undefined, true);
    assert.equal(
      await db.notification.count({
        where: {
          issueKey: `stock:BEIJING:${qa.skuIds[0]}`,
          conditionActive: true,
        },
      }),
      0,
    );
    const all = await stockPreview(owner, {
      warehouse: "MELBOURNE",
      filters: { pageSize: "1", page: "1" },
    });
    assert.ok(all.count > 1);
    pass(
      "Custom values survive default changes; zero means stockout while OFF resolves the rule; all-matching batch scope spans pagination.",
    );
    const exception = await db.notification.findFirstOrThrow({
      where: { systemPin: true, type: "LOGISTICS" },
    });
    await action(owner, exception.id, exception.version, "ack");
    await action(owner2, exception.id, exception.version, "ack");
    await bad(
      () => action(owner, exception.id, exception.version, "unpin"),
      409,
    );
    await updateAccount(owner, {
      key: key(),
      reason,
      id: owner2.id,
      role: "admin",
      active: false,
    });
    await action(owner, exception.id, exception.version, "reassign", {
      confirmerIds: [owner.id, keeper.id],
    });
    const updated = await db.notification.findUniqueOrThrow({
      where: { id: exception.id },
    });
    await action(owner, updated.id, updated.version, "ack");
    await action(keeper, updated.id, updated.version, "ack");
    await action(owner, updated.id, updated.version, "resolve");
    await action(owner, updated.id, updated.version, "unpin");
    assert.ok(
      await db.notificationHistory.count({
        where: { notificationId: updated.id, action: "reassign" },
      }),
    );
    // Existing routing still refers to disabled owner: failure must persist and a corrected rule must recover.
    const failScope = await stockPreview(owner, {
      warehouse: "BEIJING",
      ids: [qa.skuIds[1]],
    });
    await saveStockPolicies(owner, {
      key: key(),
      reason,
      warehouse: "BEIJING",
      mode: "CUSTOM",
      threshold: 100,
      ids: failScope.ids,
      expectedCount: 1,
      previewHash: failScope.hash,
    });
    await assert.rejects(() => runNotificationCheck(undefined, true));
    assert.ok(
      (
        await db.notificationJob.findUniqueOrThrow({
          where: { id: "notifications" },
        })
      ).lastError,
    );
    const routeOne = {
      assigneeId: owner.id,
      recipientIds: [owner.id],
      confirmerIds: [owner.id],
    };
    await saveRules(owner, {
      ...rule,
      key: key(),
      routing: {
        INVENTORY: routeOne,
        PRODUCT: routeOne,
        LOGISTICS: { ...routeOne, recipientIds: [owner.id, keeper.id] },
        SYSTEM: routeOne,
      },
    });
    await runNotificationCheck(undefined, true);
    assert.equal(
      (
        await db.notificationJob.findUniqueOrThrow({
          where: { id: "notifications" },
        })
      ).lastError,
      null,
    );
    pass(
      "System exception pins require both confirmations and resolution; disabled confirmers can be explicitly reassigned with history; failed tasks record an error and recover after rules are corrected.",
    );
    await saveRules(owner, {
      ...rule,
      key: key(),
      productEnabled: true,
      productNewDefault: true,
      routing: {
        INVENTORY: routeOne,
        PRODUCT: routeOne,
        LOGISTICS: routeOne,
        SYSTEM: routeOne,
      },
    });
    await runNotificationCheck(undefined, true);
    assert.equal(
      await db.notification.count({
        where: { issueKey: "product-quality-summary", conditionActive: true },
      }),
      0,
    );
    await saveProductPolicies(owner, {
      key: key(),
      reason,
      mode: "ON",
      ids: ["ops-product"],
    });
    await runNotificationCheck(undefined, true);
    const summary = await db.notification.findFirstOrThrow({
      where: { issueKey: "product-quality-summary", conditionActive: true },
    });
    assert.ok(summary.snapshot);
    await db.product.update({
      where: { id: "ops-product" },
      data: {
        description:
          "Sterling silver ring; select the listed ring size for fit.",
      },
    });
    await runNotificationCheck(undefined, true);
    assert.equal(
      (await db.notification.findUniqueOrThrow({ where: { id: summary.id } }))
        .status,
      "RESOLVED",
    );
    pass(
      "Future-only product checks leave old products alone; explicit inclusion produces one grouped problem, and completing information resolves it.",
    );
    // Exercise business events through the existing transfer services.
    const {
      createTransfer,
      dispatchTransfer,
      receiveTransfer,
      updateTransfer,
    } = await import("../../src/server/operations/transfers");
    const future =
      new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) +
      "T00:00:00.000Z";
    const past =
      new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10) +
      "T00:00:00.000Z";
    const tSku = qa.skuIds[5];
    await applyStockAction(owner, {
      key: key(),
      reason,
      variantId: tSku,
      warehouse: "BEIJING",
      kind: "PURCHASE",
      quantity: 20,
    });
    const tr = await createTransfer(owner, {
      key: key(),
      etaStart: future,
      etaEnd: future,
      lines: [{ variantId: tSku, planned: 5 }],
    });
    const line = await db.transferLine.findFirstOrThrow({
      where: { transferId: tr.id },
    });
    await dispatchTransfer(owner, tr.id, {
      key: key(),
      reason,
      dispatchedAt: new Date().toISOString(),
      lines: [{ lineId: line.id, quantity: 5 }],
    });
    await receiveTransfer(keeper, tr.id, {
      key: key(),
      reason,
      lines: [{ lineId: line.id, sellable: 1, unavailable: 0, lost: 0 }],
    });
    await runNotificationCheck(undefined, true);
    assert.equal(
      await db.notification.count({
        where: { objectId: tr.id, systemPin: true },
      }),
      0,
    );
    const partial = await db.notification.findFirstOrThrow({
      where: {
        objectId: tr.id,
        title: { contains: "partial warehouse receipt" },
      },
    });
    assert.equal(partial.actionable, false);
    assert.ok(partial.title.includes("4 remaining"));
    const eta = (value: string) =>
      updateTransfer(owner, tr.id, {
        key: key(),
        reason,
        carrier: "",
        trackingNumber: "",
        etaStart: value,
        etaEnd: value,
        exception: false,
        showRestocking: true,
        notes: "",
      });
    await eta(past);
    await runNotificationCheck(undefined, true);
    const overdue = await db.notification.findFirstOrThrow({
      where: {
        issueKey: "transit:" + tr.id + ":overdue",
        conditionActive: true,
      },
    });
    assert.equal(overdue.pinned, true);
    assert.ok(overdue.reason.includes("does not prove"));
    await eta(future);
    await runNotificationCheck(undefined, true);
    assert.equal(
      (await db.notification.findUniqueOrThrow({ where: { id: overdue.id } }))
        .status,
      "RESOLVED",
    );
    assert.ok(
      await db.auditLog.count({
        where: { action: "TRANSFER_UPDATED", objectId: tr.id },
      }),
    );
    await eta(past);
    await runNotificationCheck(undefined, true);
    const relapse = await db.notification.findFirstOrThrow({
      where: { issueKey: overdue.issueKey, conditionActive: true },
    });
    assert.notEqual(relapse.id, overdue.id);
    await receiveTransfer(keeper, tr.id, {
      key: key(),
      reason,
      lines: [{ lineId: line.id, sellable: 3, unavailable: 1, lost: 0 }],
    });
    await runNotificationCheck(undefined, true);
    assert.equal(
      (await db.notification.findUniqueOrThrow({ where: { id: relapse.id } }))
        .status,
      "RESOLVED",
    );
    const damaged = await db.notification.findFirstOrThrow({
      where: { issueKey: "damage:" + tr.id, conditionActive: true },
    });
    assert.equal(damaged.pinned, true);
    assert.equal(damaged.status, "OPEN");
    pass(
      "Partial receipts remain information with remaining quantities; ETA edits retain history and end the old overdue cycle; relapse creates a new cycle; completed receipts resolve overdue independently of pinned damage.",
    );

    // Concurrent acknowledgments/unpin serialize against each other and scans.
    await action(owner, damaged.id, damaged.version, "reassign", {
      confirmerIds: [owner.id, keeper.id],
    });
    const concurrent = await db.notification.findUniqueOrThrow({
      where: { id: damaged.id },
    });
    await action(owner, concurrent.id, concurrent.version, "resolve");
    const attempt = await Promise.allSettled([
      action(owner, concurrent.id, concurrent.version, "ack"),
      action(keeper, concurrent.id, concurrent.version, "ack"),
      action(owner, concurrent.id, concurrent.version, "unpin"),
      runNotificationCheck(undefined, true),
    ]);
    assert.equal(attempt[0].status, "fulfilled");
    assert.equal(attempt[1].status, "fulfilled");
    await action(owner, concurrent.id, concurrent.version, "unpin");
    assert.equal(
      await db.notificationReceipt.count({
        where: {
          notificationId: concurrent.id,
          version: concurrent.version,
          kind: "ACK",
        },
      }),
      2,
    );
    pass(
      "Concurrent confirmations, unpin and scanner runs preserve required acknowledgments and do not duplicate receipts.",
    );

    const ancient = new Date("2025-01-02T03:00:00Z");
    await db.notification.update({
      where: { id: partial.id },
      data: { createdAt: ancient, updatedAt: new Date() },
    });
    assert.ok(
      !(await listNotifications(owner, {})).items.some(
        (i) => i.id === partial.id,
      ),
    );
    assert.ok(
      (
        await listNotifications(owner, { day: "2025-01-02", view: "all" })
      ).items.some((i) => i.id === partial.id),
    );
    await action(owner, partial.id, partial.version, "pin", {
      confirmerIds: [owner.id],
    });
    assert.ok(
      (await listNotifications(owner, {})).items.some(
        (i) => i.id === partial.id,
      ),
    );
    pass(
      "Today uses first creation, not update time; historical dates find old information; old pinned items appear once.",
    );
    const today = await listNotifications(owner, {});
    assert.equal(
      new Set(today.items.map((n) => n.id)).size,
      today.items.length,
    );
    await fsReport();
    console.log(`PASS: ${checks.length} notification acceptance groups.`);
    async function fsReport() {
      await writeFile(
        ".local/notification-verification.json",
        JSON.stringify({ passed: true, checks }, null, 2),
        { mode: 0o600 },
      );
    }
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(
    "Notification verification failed:",
    e instanceof assert.AssertionError
      ? `${e.operator}: ${String(e.actual)} / ${String(e.expected)}`
      : e instanceof Error
        ? e.message
        : "Unknown",
  );
  process.exitCode = 1;
});
