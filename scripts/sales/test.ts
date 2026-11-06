import assert from "node:assert/strict";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Actor } from "../../src/server/operations/core";
async function main() {
  config({ path: ".local/operations-test.env", quiet: true });
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/forme_operations_test",
  );
  const { database } = await import("../../src/server/db"),
    db = database();
  const qa = JSON.parse(await readFile(".local/operations-qa.json", "utf8"));
  const owner = { id: qa.ownerId, role: "admin" as const },
    keeper = { id: qa.warehouseId, role: "warehouse" as const };
  const others = await db.user.findMany({
    where: { role: "admin", active: true, id: { not: owner.id } },
  });
  const approver = { id: others[0]?.id || owner.id, role: "admin" as const };
  const W = await import("../../src/server/sales/workflows"),
    Q = await import("../../src/server/sales/queries"),
    A = await import("../../src/server/sales/analytics"),
    T = await import("../../src/server/sales/timeouts"),
    O = await import("../../src/server/operations/orders"),
    I = await import("../../src/server/operations/inventory"),
    B = await import("../../src/server/business/attachments"),
    E = await import("../../src/server/business/expenses");
  const { allocate } = await import("../../src/server/sales/events"),
    { runNotificationCheck } =
      await import("../../src/server/notifications/engine"),
    { dashboard } = await import("../../src/server/sales/dashboard");
  const checks: string[] = [],
    pass = (s: string) => {
      checks.push(s);
      console.log("PASS: " + s);
    },
    base = () => ({
      key: randomUUID(),
      reason: "Synthetic third-batch acceptance evidence",
    }),
    now = () => new Date().toISOString();
  const bad = (f: () => Promise<unknown>, status: number) =>
    assert.rejects(
      f,
      (e) =>
        !!e && typeof e === "object" && "status" in e && e.status === status,
    );
  try {
    const prefix = randomUUID().slice(0, 8);
    const product = await db.product.create({
      data: {
        name: "Sales sample " + prefix,
        slug: "sales-" + prefix,
        status: "PUBLISHED",
        categoryId: "rings",
        collections: {
          create: [{ collectionId: "quiet-form" }, { collectionId: "linked" }],
        },
        variants: {
          create: [
            {
              sku: "SALES-A-" + prefix,
              priceCents: 1000,
              compareAtPriceCents: 2000,
            },
            { sku: "SALES-B-" + prefix, priceCents: 2000 },
          ],
        },
      },
      include: { variants: true },
    });
    const [a, b] = product.variants;
    for (const v of [a, b])
      await db.$transaction((tx) =>
        I.changeBalance(
          tx,
          owner,
          v.id,
          "MELBOURNE",
          { onHand: 40 },
          "MANUAL_IN",
          "verification",
          prefix,
          "Synthetic sample stock",
        ),
      );
    await db.commerceSettings.update({
      where: { id: "commerce" },
      data: { shippingCents: 500, reservationMinutes: 60 },
    });
    const campaignInput = {
      ...base(),
      name: "Synthetic association " + prefix,
      startsAt: "2020-01-01T00:00:00Z",
      endsAt: "2030-01-01T00:00:00Z",
      variantIds: [a.id, b.id],
      active: true,
      notes: "Association only; no pricing changes",
    };
    const campaign = await W.saveCampaign(owner, campaignInput);
    await W.saveCampaign(owner, {
      ...campaignInput,
      ...base(),
      name: "Overlapping association " + prefix,
    });
    const checkout = (items: { variantId: string; quantity: number }[]) => ({
      ...base(),
      reason: undefined,
      email: "sales-sample@verification.invalid",
      recipientName: "Synthetic recipient",
      addressLine1: "1 Test Street",
      addressLine2: "",
      city: "Melbourne",
      state: "VIC",
      postcode: "3000",
      country: "AU",
      items,
    });
    const make = async (
      items: { variantId: string; quantity: number }[],
      paidAt: string,
    ) => {
      const inp = checkout(items);
      delete (inp as { reason?: unknown }).reason;
      const o = await O.createOrder(inp);
      await db.shopOrder.update({
        where: { id: o.id },
        data: { createdAt: new Date("2026-09-25T00:00:00Z") },
      });
      const bytes = await sharp({
        create: { width: 3, height: 3, channels: 3, background: "#ddd" },
      })
        .png()
        .toBuffer();
      const evidence = await B.uploadAttachments(owner, "order", o.id, [
        new File([bytes], "sample.png", { type: "image/png" }),
      ]);
      const proof = evidence[0].id;
      const pay = {
        ...base(),
        action: "PAYMENT",
        occurredAt: paidAt,
        reference: "PAY-" + randomUUID(),
        evidenceId: proof,
      };
      await W.orderAction(owner, o.id, pay);
      await W.orderAction(owner, o.id, pay);
      return o;
    };
    const first = await make(
        [
          { variantId: a.id, quantity: 2 },
          { variantId: b.id, quantity: 1 },
        ],
        "2026-10-01T02:00:00Z",
      ),
      second = await make(
        [{ variantId: a.id, quantity: 1 }],
        "2026-10-03T02:00:00Z",
      );
    const o1 = await db.shopOrder.findUniqueOrThrow({
      where: { id: first.id },
      include: { lines: true },
    });
    assert.equal(o1.totalCents, 4500);
    assert.equal(o1.actualDiscountCents, 0);
    assert.equal(o1.discountCents, 2000);
    assert.equal(
      await db.orderEvent.count({
        where: { orderId: first.id, type: "PAYMENT_SUCCEEDED" },
      }),
      1,
    );
    assert.ok(o1.lines.every((l) => l.actualDiscountCents === 0));
    pass(
      "Verified payment retries create one event; compare-at reference savings stay separate from zero actually applied discounts. Two overlapping campaigns are frozen as association snapshots.",
    );
    await db.product.update({
      where: { id: product.id },
      data: { name: "Changed current name", categoryId: "bracelets" },
    });
    await db.productVariant.update({
      where: { id: a.id },
      data: { priceCents: 9000, compareAtPriceCents: null },
    });
    await W.saveCampaign(owner, {
      ...campaignInput,
      ...base(),
      id: campaign.id,
      version: 1,
      name: "Renamed current campaign",
    });
    const filtered = await Q.orders(owner, {
      category: "rings",
      sku: a.sku,
      from: "2026-10-01",
      to: "2026-10-31",
      dateField: "paid",
      pageSize: 1,
    });
    assert.equal(typeof filtered, "object");
    if (typeof filtered !== "string") {
      assert.equal(filtered.total, 2);
      assert.equal(filtered.items.length, 1);
      assert.equal(filtered.summary?.wholeOrders.totalCents, 6000);
      assert.equal(filtered.summary?.matchedLines?.lineTotalCents, 3000);
    }
    await Q.saveFilter(owner, {
      ...base(),
      name: "Synthetic saved " + prefix,
      query: { sku: a.sku, category: "rings", dateField: "paid" },
    });
    assert.ok((await Q.metadata(owner)).filters.length);
    assert.equal((await Q.metadata(keeper)).filters.length, 0);
    pass(
      "Snapshot category/SKU filters survive current product edits; whole orders count once, matching-line sums differ correctly, pagination and private saved filters work.",
    );
    const newCase = async (orderId: string) =>
      W.saveCase(owner, {
        ...base(),
        orderId,
        type: "DAMAGE",
        source: "STAFF",
        summary: "Synthetic damaged delivery report",
        assigneeId: keeper.id,
        priority: 2,
        dueAt: "2026-10-10T03:00:00Z",
        occurredAt: "2026-10-06T03:00:00Z",
      });
    const c = await newCase(first.id),
      c2 = await newCase(second.id);
    await W.caseAction(keeper, c.id, {
      ...base(),
      version: 1,
      action: "RESPONSE",
      content: "Manually recorded response; no message sent",
      occurredAt: "2026-10-07T03:00:00Z",
    });
    const request = async (
      caseId: string,
      amount: number,
      type = "PARTIAL_REFUND",
      lines: unknown[] = [],
    ) =>
      W.saveCompensation(owner, {
        ...base(),
        caseId,
        type,
        amountCents: amount,
        currency: "AUD",
        lines,
        basis: "Synthetic verified compensation",
        executorId: keeper.id,
        dueAt: "2026-11-01T02:00:00Z",
      });
    const action = async (
      id: string,
      action: string,
      extra: Record<string, unknown> = {},
      actor: Actor = owner,
    ) => {
      const c = await db.compensation.findUniqueOrThrow({ where: { id } });
      return W.compensationAction(actor, id, {
        ...base(),
        version: c.version,
        action,
        occurredAt: now(),
        ...extra,
      });
    };
    const refund = await request(c.id, 500);
    await action(refund.id, "SUBMIT");
    await bad(() => action(refund.id, "APPROVE", {}, keeper), 403);
    if (others.length) await bad(() => action(refund.id, "APPROVE"), 409);
    await action(refund.id, "APPROVE", {}, approver);
    assert.equal(
      (await db.shopOrder.findUniqueOrThrow({ where: { id: first.id } }))
        .recordedRefundCents,
      0,
    );
    const bytes = await sharp({
      create: { width: 4, height: 4, channels: 3, background: "#333" },
    })
      .png()
      .toBuffer();
    const evidence = await B.uploadAttachments(
      owner,
      "compensation",
      refund.id,
      [new File([bytes], "refund.png", { type: "image/png" })],
    );
    const proof = evidence[0].id;
    await bad(() => B.downloadAttachment(keeper, proof), 403);
    const before = await db.inventoryBalance.findUniqueOrThrow({
      where: {
        variantId_warehouse: { variantId: a.id, warehouse: "MELBOURNE" },
      },
    });
    const rv = await db.compensation.findUniqueOrThrow({
        where: { id: refund.id },
      }),
      execute = {
        ...base(),
        version: rv.version,
        action: "REFUND",
        occurredAt: "2026-11-01T03:00:00Z",
        reference: "REF-" + randomUUID(),
        channel: "Synthetic external evidence",
        source: "MANUAL",
        evidenceId: proof,
      };
    await W.compensationAction(owner, refund.id, execute);
    await W.compensationAction(owner, refund.id, execute);
    assert.equal(
      await db.orderRefund.count({ where: { compensationId: refund.id } }),
      1,
    );
    assert.deepEqual(
      await db.inventoryBalance.findUniqueOrThrow({ where: { id: before.id } }),
      before,
    );
    const done = await db.compensation.findUniqueOrThrow({
      where: { id: refund.id },
    });
    assert.ok(done.expenseId);
    assert.equal(
      await db.cashRecord.count({ where: { expenseId: done.expenseId! } }),
      1,
    );
    await bad(
      () =>
        E.recordCash(owner, done.expenseId!, {
          ...base(),
          kind: "PAYMENT",
          status: "CONFIRMED",
          amount: 500,
          currency: "AUD",
          occurredAt: now(),
          source: "MANUAL",
          accountAlias: "test",
          channel: "manual",
          reference: "duplicate",
        }),
      409,
    );
    pass(
      "Owner approval is distinct from actual refund; direct warehouse execution/evidence denied. External refund repeats once, links one expense cash fact and never restores stock.",
    );
    const r1 = await request(c2.id, 1000),
      r2 = await request(c2.id, 1000);
    await action(r1.id, "SUBMIT");
    await action(r2.id, "SUBMIT");
    const races = await Promise.allSettled([
      action(r1.id, "APPROVE", {}, approver),
      action(r2.id, "APPROVE", {}, approver),
    ]);
    assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
    const approved = await db.compensation.findFirstOrThrow({
      where: { id: { in: [r1.id, r2.id] }, status: "APPROVED" },
    });
    await action(approved.id, "CANCEL");
    pass(
      "Concurrent approved refund requests reserve remaining receipt capacity; exactly one competing request is approved, and cancellation frees the hold.",
    );
    const rep = await request(c.id, 0, "REPLACEMENT", [
      { variantId: a.id, quantity: 1 },
    ]);
    await action(rep.id, "SUBMIT");
    await action(rep.id, "APPROVE", {}, approver);
    const beforeReserve = await db.inventoryBalance.findUniqueOrThrow({
      where: { id: before.id },
    });
    await action(rep.id, "RESERVE_REPLACEMENT");
    let balance = await db.inventoryBalance.findUniqueOrThrow({
      where: { id: before.id },
    });
    assert.equal(balance.reserved, beforeReserve.reserved + 1);
    const repReady = await db.compensation.findUniqueOrThrow({
        where: { id: rep.id },
      }),
      shipping = {
        ...base(),
        version: repReady.version,
        action: "SHIP_REPLACEMENT",
        occurredAt: now(),
        carrier: "Synthetic carrier",
        trackingNumber: "REPLACE-" + prefix,
      };
    await W.compensationAction(keeper, rep.id, shipping);
    await W.compensationAction(keeper, rep.id, shipping);
    balance = await db.inventoryBalance.findUniqueOrThrow({
      where: { id: before.id },
    });
    assert.equal(balance.onHand, beforeReserve.onHand - 1);
    assert.equal(balance.reserved, beforeReserve.reserved);
    assert.equal(
      await db.orderEvent.count({
        where: { orderId: first.id, type: "PAYMENT_SUCCEEDED" },
      }),
      1,
    );
    const repCancel = await request(c.id, 0, "REPLACEMENT", [
      { variantId: b.id, quantity: 1 },
    ]);
    await action(repCancel.id, "SUBMIT");
    await action(repCancel.id, "APPROVE", {}, approver);
    await action(repCancel.id, "RESERVE_REPLACEMENT");
    await action(repCancel.id, "CANCEL");
    assert.equal(
      (
        await db.replacementShipment.findUniqueOrThrow({
          where: { compensationId: repCancel.id },
        })
      ).status,
      "CANCELLED",
    );
    pass(
      "Replacement reserves and dispatches exactly once using existing inventory balances; no sale is added. Cancelling an unshipped replacement releases its reservation.",
    );
    const coupon = await request(c.id, 0, "COUPON");
    await action(coupon.id, "SUBMIT");
    await action(coupon.id, "APPROVE", {}, approver);
    await bad(
      () => action(coupon.id, "OTHER_COMPLETE", { evidenceId: proof }),
      409,
    );
    await W.saveCompensation(owner, {
      ...base(),
      id: coupon.id,
      version: (
        await db.compensation.findUniqueOrThrow({ where: { id: coupon.id } })
      ).version,
      caseId: c.id,
      type: "OTHER",
      amountCents: 0,
      currency: "AUD",
      lines: [],
      basis: "Revised approved request requires a new review",
      executorId: keeper.id,
      dueAt: now(),
    });
    assert.equal(
      (await db.compensation.findUniqueOrThrow({ where: { id: coupon.id } }))
        .status,
      "SUBMITTED",
    );
    pass(
      "No coupon engine means no false issuance. Revising approved compensation resets approval and requires a fresh decision.",
    );
    assert.deepEqual(allocate(5, [1, 1, 1]), [2, 2, 1]);
    assert.equal(
      allocate(101, [10, 20, 30]).reduce((a, b) => a + b, 0),
      101,
    );
    const report = await A.analytics(owner, {
      from: "2026-10-01",
      to: "2026-10-31",
      asOf: "2026-11-03",
      timezone: "Australia/Melbourne",
      product: product.id,
    });
    assert.ok(typeof report !== "string");
    if (typeof report !== "string") {
      assert.deepEqual(
        {
          orders: report.totals.orders,
          units: report.totals.units,
          merchandise: report.totals.merchandise,
          received: report.totals.received,
          refunded: report.totals.refunded,
          discount: report.totals.discount,
        },
        {
          orders: 2,
          units: 4,
          merchandise: 5000,
          received: 6000,
          refunded: 0,
          discount: 0,
        },
      );
      assert.equal(report.cohort.refundCents, 500);
      assert.equal(
        report.dimensions.collection.reduce((n, r) => n + r.amount, 0),
        10000,
      );
      assert.equal(
        report.dimensions.campaign.reduce((n, r) => n + r.amount, 0),
        10000,
      );
      assert.deepEqual(report.orderBands, { "[0,50)": 2 });
      assert.equal(report.dimensions.unitBand[0].units, 4);
    }
    const nov = await A.analytics(owner, {
      from: "2026-11-01",
      to: "2026-11-03",
      asOf: "2026-11-03",
      product: product.id,
    });
    assert.ok(typeof nov !== "string");
    if (typeof nov !== "string") {
      assert.equal(nov.totals.refunded, 500);
      assert.equal(nov.totals.orders, 0);
      assert.equal(nov.totals.units, 0);
      assert.equal(nov.totals.net, -500);
    }
    const csv = await A.analytics(owner, {
      from: "2026-10-01",
      to: "2026-10-31",
      asOf: "2026-11-03",
      product: product.id,
      format: "csv",
    });
    assert.ok(
      typeof csv === "string" &&
        csv.includes("6000") === false &&
        csv.includes("4500"),
    );
    pass(
      "Reproducible sample: October 2 orders / 4 units / AUD50 merchandise / AUD60 receipts; November AUD5 refund has zero negative sales units; October cohort shows AUD5 refund. Campaign/collection overlap does not inflate totals. Exact allocation and export agree.",
    );
    const cal = {
      days: 1,
      dayMode: "BUSINESS",
      timezone: "Australia/Melbourne",
      weekends: [0, 6],
      holidays: ["2026-10-05"],
    };
    assert.equal(
      T.deadline(new Date("2026-10-02T02:00:00Z"), cal).toISOString(),
      "2026-10-06T13:00:00.000Z",
    );
    const rule = {
      ...base(),
      kind: "SHIPMENT",
      version: 0,
      enabled: true,
      days: 1,
      dayMode: "BUSINESS",
      timezone: "Australia/Melbourne",
      weekends: [0, 6],
      holidays: [],
      shippingMethod: "STANDARD_AU",
      includeTest: false,
      assigneeId: owner.id,
      recipientIds: [owner.id],
      confirmerIds: [owner.id],
      severity: 1,
      pin: true,
      escalateDays: 3,
      apply: "FUTURE",
    };
    await T.saveRule(owner, rule);
    await runNotificationCheck(undefined, true);
    await runNotificationCheck(undefined, true);
    const timer = await db.orderTimer.findUniqueOrThrow({
      where: { kind_objectId: { kind: "SHIPMENT", objectId: first.id } },
    });
    assert.equal(
      await db.notification.count({
        where: { issueKey: "order-timeout:" + timer.id, conditionActive: true },
      }),
      1,
    );
    await T.pauseTimer(owner, timer.id, {
      ...base(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await bad(
      () =>
        T.pauseTimer(owner, timer.id, {
          ...base(),
          endsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
        }),
      400,
    );
    await runNotificationCheck(undefined, true);
    assert.equal(
      await db.notification.count({
        where: { issueKey: "order-timeout:" + timer.id, conditionActive: true },
      }),
      0,
    );
    const oldDeadline = (
      await db.orderTimer.findUniqueOrThrow({ where: { id: timer.id } })
    ).deadlineAt;
    await T.saveRule(owner, {
      ...rule,
      ...base(),
      version: 1,
      days: 3,
      apply: "FUTURE",
    });
    await runNotificationCheck(undefined, true);
    assert.equal(
      (
        await db.orderTimer.findUniqueOrThrow({ where: { id: timer.id } })
      ).deadlineAt.toISOString(),
      oldDeadline.toISOString(),
    );
    await O.shipOrder(owner, first.id, {
      ...base(),
      carrier: "Synthetic carrier",
      trackingNumber: "ORIGINAL-" + prefix,
    });
    await runNotificationCheck(undefined, true);
    assert.equal(
      (await db.orderTimer.findUniqueOrThrow({ where: { id: timer.id } }))
        .active,
      false,
    );
    await W.orderAction(owner, first.id, {
      ...base(),
      action: "ETA",
      eta: "2026-10-31",
      occurredAt: now(),
    });
    await T.saveRule(owner, {
      ...rule,
      ...base(),
      kind: "DELIVERY",
      version: 0,
      dayMode: "CALENDAR",
      days: 0,
    });
    await runNotificationCheck(undefined, true);
    const delivery = await db.orderTimer.findUniqueOrThrow({
      where: { kind_objectId: { kind: "DELIVERY", objectId: first.id } },
    });
    assert.ok(
      (
        await db.notification.findFirstOrThrow({
          where: {
            issueKey: "order-timeout:" + delivery.id,
            conditionActive: true,
          },
        })
      ).title.includes("delivery not recorded"),
    );
    await W.orderAction(keeper, first.id, {
      ...base(),
      action: "DELIVERED",
      content: "Synthetic manual delivery evidence",
      occurredAt: now(),
    });
    await runNotificationCheck(undefined, true);
    assert.equal(
      (await db.orderTimer.findUniqueOrThrow({ where: { id: delivery.id } }))
        .active,
      false,
    );
    pass(
      "Configured weekends/holidays and Melbourne DST determine deadlines; repeated scans deduplicate; bounded pauses and explicit future-only rule versions preserve history. Shipment/delivery records resolve matching timers without claiming external tracking.",
    );
    await bad(
      () =>
        A.analytics(keeper, {
          from: "2026-10-01",
          to: "2026-10-31",
          asOf: "2026-11-03",
        }),
      403,
    );
    await bad(() => Q.orders(keeper, { format: "csv" }), 403);
    await W.orderAction(owner, first.id, {
      ...base(),
      action: "NOTE",
      content: "PRIVATE-SALES-NOTE",
      occurredAt: now(),
    });
    assert.ok(
      !JSON.stringify(
        await O.orderDetails({ id: "guest", role: "guest" }, first.id),
      ).includes("PRIVATE-SALES-NOTE"),
    );
    const home = await dashboard(keeper);
    assert.ok(home.items.some((t) => t.objectId === c.id));
    assert.ok(!home.items.some((t) => t.source === "expense"));
    const confirmation = await dashboard(owner, "confirmation");
    assert.ok(confirmation.items.every((t) => t.confirmation));
    await assert.rejects(() =>
      db.orderRefund.updateMany({
        where: { compensationId: refund.id },
        data: { amountCents: 1 },
      }),
    );
    pass(
      "Warehouse statistics/customer export are denied, guest responses exclude internal notes, role dashboards aggregate linked work, and refund history is append-only.",
    );
    await writeFile(
      ".local/sales-verification.json",
      JSON.stringify({
        passed: true,
        checks,
        orderId: first.id,
        secondOrderId: second.id,
        productId: product.id,
        caseId: c.id,
        compensationId: refund.id,
        attachmentId: proof,
        sku: a.sku,
        campaignId: campaign.id,
      }),
      { mode: 0o600 },
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(
    "Sales verification failed:",
    e instanceof Error ? e.message : "unknown",
  );
  process.exitCode = 1;
});
