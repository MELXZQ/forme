import assert from "node:assert/strict";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
async function main() {
  config({ path: ".local/operations-test.env", quiet: true });
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/forme_operations_test",
  );
  const { database } = await import("../../src/server/db");
  const db = database();
  const P = await import("../../src/server/business/purchases"),
    E = await import("../../src/server/business/expenses"),
    L = await import("../../src/server/business/logistics"),
    Q = await import("../../src/server/business/queries"),
    R = await import("../../src/server/business/recurring"),
    A = await import("../../src/server/business/attachments"),
    C = await import("../../src/server/business/calendar");
  const { runNotificationCheck } =
    await import("../../src/server/notifications/engine");
  const qa = JSON.parse(await readFile(".local/operations-qa.json", "utf8")),
    owner = { id: qa.ownerId, role: "admin" as const },
    keeper = { id: qa.warehouseId, role: "warehouse" as const };
  const key = () => randomUUID(),
    base = () => ({
      key: key(),
      reason: "Synthetic business acceptance evidence",
    }),
    now = () => new Date().toISOString(),
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Melbourne",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
    checks: string[] = [];
  const pass = (v: string) => {
    checks.push(v);
    console.log("PASS: " + v);
  };
  const bad = (fn: () => Promise<unknown>, status: number) =>
    assert.rejects(
      fn,
      (e) =>
        !!e && typeof e === "object" && "status" in e && e.status === status,
    );
  const balance = async () =>
    await db.inventoryBalance.findUniqueOrThrow({
      where: {
        variantId_warehouse: {
          variantId: qa.skuIds[0],
          warehouse: "MELBOURNE",
        },
      },
    });
  try {
    const rules = await db.notificationRuleSettings.findUniqueOrThrow({
      where: { id: "notifications" },
    });
    const route = {
      assigneeId: owner.id,
      recipientIds: [owner.id],
      confirmerIds: [owner.id],
    };
    await db.notificationRuleSettings.update({
      where: { id: rules.id },
      data: {
        routing: {
          ...(rules.routing as object),
          PROCUREMENT: route,
          FINANCE: route,
        },
      },
    });
    const supplier = await P.saveSupplier(owner, {
      ...base(),
      code: "BUS-" + key(),
      name: "Synthetic supplier",
      currency: "CNY",
    });
    await P.saveSource(owner, {
      ...base(),
      supplierId: supplier.id,
      variantId: qa.skuIds[0],
      supplierCode: "SOURCE-A",
    });
    await P.saveSource(owner, {
      ...base(),
      supplierId: supplier.id,
      variantId: qa.skuIds[0],
      supplierCode: "SOURCE-B",
    });
    const purchaseInput = {
      supplierId: supplier.id,
      assigneeId: owner.id,
      warehouse: "MELBOURNE" as const,
      orderedAt: now(),
      etaStart: "2001-01-01",
      etaEnd: "2001-01-02",
      currency: "CNY",
      discount: 0,
      domesticShipping: 200,
      otherFees: 100,
      notes: "Synthetic test purchase",
      lines: [
        {
          variantId: qa.skuIds[0],
          supplierCode: "SOURCE-A",
          quantity: 20,
          unitCost: 100,
        },
      ],
    };
    const before = await balance();
    const purchase = await P.savePurchase(owner, {
      ...base(),
      ...purchaseInput,
    });
    const draft = await db.purchase.findUniqueOrThrow({
      where: { id: purchase.id },
      include: { lines: true },
    });
    assert.equal(draft.total, 2300);
    assert.equal((await balance()).onHand, before.onHand);
    const confirmation = await P.confirmPurchase(owner, purchase.id, {
      ...base(),
      version: draft.version,
    });
    const expenseId = confirmation.expenseId;
    assert.equal(
      await db.expense.count({ where: { purchaseId: purchase.id } }),
      1,
    );
    assert.equal((await balance()).onHand, before.onHand);
    pass(
      "Creating and confirming a 20-unit purchase creates one obligation and no inventory. Multiple supplier SKU sources are supported.",
    );
    const cash = (amount: number, reference: string) => ({
      ...base(),
      kind: "PAYMENT",
      status: "CONFIRMED",
      amount,
      currency: "CNY",
      occurredAt: now(),
      source: "MANUAL",
      accountAlias: "Synthetic account",
      channel: "Manual evidence",
      reference,
    });
    const payment = cash(1000, "partial-" + key());
    await Promise.all([
      E.recordCash(owner, expenseId, payment),
      E.recordCash(owner, expenseId, payment),
    ]);
    assert.equal((await Q.expenseDetail(owner, expenseId)).paid, 1000);
    assert.equal(
      (await Q.purchases(owner, {})).items.find((x) => x.id === purchase.id)
        ?.paymentStatus,
      "PART_PAID",
    );
    assert.equal((await balance()).onHand, before.onHand);
    pass(
      "Concurrent identical partial-payment requests create one cash record and do not change inventory.",
    );
    const parcelInput = {
      type: "SUPPLIER_INBOUND",
      purchaseId: purchase.id,
      assigneeId: owner.id,
      sourcePlace: "Synthetic supplier",
      destinationPlace: "Melbourne warehouse",
      warehouse: "MELBOURNE",
      timezone: "Australia/Melbourne",
      sender: "Synthetic sender",
      recipient: "Synthetic receiver",
      carrier: "Manual carrier",
      trackingNumber: "TRACK-" + key(),
      packageCount: 1,
      etaStart: "2001-01-01",
      etaEnd: "2001-01-02",
      lines: [
        {
          variantId: qa.skuIds[0],
          purchaseLineId: draft.lines[0].id,
          quantity: 10,
        },
      ],
    };
    const parcel1 = await L.createParcel(owner, { ...base(), ...parcelInput });
    const parcel2 = await L.createParcel(owner, {
      ...base(),
      ...parcelInput,
      trackingNumber: "TRACK-" + key(),
    });
    await bad(
      () =>
        L.createParcel(owner, {
          ...base(),
          ...parcelInput,
          trackingNumber: "EXCESS-" + key(),
        }),
      409,
    );
    const event = (event: string) => ({
      ...base(),
      event,
      reference: event + "-" + key(),
      occurredAt: now(),
      source: "MANUAL",
    });
    await L.parcelEvent(keeper, parcel1.id, event("DISPATCHED"));
    await L.parcelEvent(keeper, parcel1.id, event("SIGNED"));
    assert.equal((await balance()).onHand, before.onHand);
    pass(
      "A purchase supports two allocated parcels; over-allocation is rejected. Manual signature does not receive stock.",
    );
    const receipt1 = {
      ...base(),
      reference: "ACCEPT-" + key(),
      parcelId: parcel1.id,
      occurredAt: now(),
      lines: [{ lineId: draft.lines[0].id, sellable: 10, unavailable: 0 }],
    };
    await P.receivePurchase(keeper, purchase.id, receipt1);
    await P.receivePurchase(owner, purchase.id, { ...receipt1, key: key() });
    const receipt2 = {
      ...base(),
      reference: "ACCEPT-" + key(),
      parcelId: parcel2.id,
      occurredAt: now(),
      lines: [{ lineId: draft.lines[0].id, sellable: 7, unavailable: 1 }],
    };
    await Promise.all([
      P.receivePurchase(owner, purchase.id, receipt2),
      P.receivePurchase(owner, purchase.id, receipt2),
    ]);
    let detail = await Q.purchaseDetail(owner, purchase.id);
    assert.equal(detail.lines[0].remaining, 2);
    assert.equal(detail.lines[0].receivedSellable, 17);
    assert.equal(detail.lines[0].receivedUnavailable, 1);
    assert.equal((await balance()).onHand, before.onHand + 18);
    assert.equal((await balance()).unavailable, before.unavailable + 1);
    assert.equal(detail.receipts.length, 2);
    const list = await Q.logistics(owner, {});
    assert.ok(typeof list !== "string");
    if (typeof list === "string") throw new Error("Unexpected CSV");
    assert.equal(
      list.items.find((r) => r.id === parcel1.id)?.acceptanceStatus,
      "RECEIVED",
    );
    assert.equal(
      list.items.find((r) => r.id === parcel2.id)?.acceptanceStatus,
      "PART_RECEIVED",
    );
    pass(
      "20 agreed, 18 accepted (17 sellable / 1 unavailable), 2 pending. Cross-entry and concurrent acceptance retries do not duplicate stock; each parcel has independent progress.",
    );
    await bad(
      () =>
        P.receivePurchase(owner, purchase.id, {
          ...base(),
          reference: "OVER-" + key(),
          occurredAt: now(),
          lines: [{ lineId: draft.lines[0].id, sellable: 3, unavailable: 0 }],
        }),
      409,
    );
    await bad(
      () =>
        P.finishPurchase(owner, purchase.id, {
          ...base(),
          version: detail.version,
          status: "CANCELLED",
        }),
      409,
    );
    await P.closePurchaseLine(owner, purchase.id, {
      ...base(),
      lineId: draft.lines[0].id,
      quantity: 2,
      kind: "SHORTAGE",
    });
    assert.equal(
      (await Q.purchaseDetail(owner, purchase.id)).lines[0].remaining,
      0,
    );
    assert.equal((await balance()).onHand, before.onHand + 18);
    const returned = await P.returnSupplier(owner, purchase.id, {
      ...base(),
      reference: "RET-" + key(),
      occurredAt: now(),
      disposition: "REFUND",
      refundDueAt: "2001-01-01",
      lines: [{ lineId: draft.lines[0].id, sellable: 0, unavailable: 1 }],
    });
    assert.equal((await balance()).onHand, before.onHand + 17);
    assert.equal(
      (await Q.purchaseDetail(owner, purchase.id)).lines[0].remaining,
      0,
    );
    assert.equal((await Q.expenseDetail(owner, expenseId)).refund, 0);
    await E.recordCash(owner, expenseId, {
      ...cash(100, "REF-" + key()),
      kind: "REFUND",
    });
    assert.equal((await Q.expenseDetail(owner, expenseId)).refund, 100);
    pass(
      "Excess receipts and unconditional cancellation are rejected. Explicit shortage, physical supplier return and actual refund remain independent; refund disposition creates no replacement commitment.",
    );
    const replacement = await P.returnSupplier(owner, purchase.id, {
      ...base(),
      reference: "REPLACE-" + key(),
      occurredAt: now(),
      disposition: "REPLACEMENT",
      lines: [{ lineId: draft.lines[0].id, sellable: 1, unavailable: 0 }],
    });
    void replacement;
    assert.equal(
      (await Q.purchaseDetail(owner, purchase.id)).lines[0].remaining,
      1,
    );
    await P.receivePurchase(owner, purchase.id, {
      ...base(),
      reference: "REPLACED-" + key(),
      occurredAt: now(),
      lines: [{ lineId: draft.lines[0].id, sellable: 1, unavailable: 0 }],
    });
    assert.equal((await balance()).onHand, before.onHand + 17);
    pass(
      "Explicit replacement dispatch reduces stock once and adds one remaining commitment; the replacement is stocked only on a new acceptance.",
    );
    detail = await Q.purchaseDetail(owner, purchase.id);
    const snapshot = JSON.stringify(detail.supplierSnapshot),
      lineSnapshot = JSON.stringify(detail.lines[0].snapshot);
    await P.saveSupplier(owner, {
      ...base(),
      id: supplier.id,
      code: "CHANGED-" + key(),
      name: "Changed supplier",
      currency: "AUD",
    });
    const product = await db.productVariant.findUniqueOrThrow({
      where: { id: qa.skuIds[0] },
      include: { product: true },
    });
    await db.product.update({
      where: { id: product.productId },
      data: { name: "Changed product for snapshot test" },
    });
    assert.equal(
      JSON.stringify(
        (await Q.purchaseDetail(owner, purchase.id)).supplierSnapshot,
      ),
      snapshot,
    );
    assert.equal(
      JSON.stringify(
        (await Q.purchaseDetail(owner, purchase.id)).lines[0].snapshot,
      ),
      lineSnapshot,
    );
    await db.product.update({
      where: { id: product.productId },
      data: { name: product.product.name },
    });
    await bad(
      () =>
        P.savePurchase(owner, {
          ...base(),
          ...purchaseInput,
          id: purchase.id,
          version: detail.version,
          otherFees: 200,
        }),
      409,
    );
    await P.savePurchase(owner, {
      ...base(),
      ...purchaseInput,
      id: purchase.id,
      version: detail.version,
      otherFees: 200,
      acknowledgePayments: true,
    });
    assert.equal((await Q.expenseDetail(owner, expenseId)).amount, 2400);
    assert.equal((await Q.expenseDetail(owner, expenseId)).paid, 1000);
    pass(
      "Supplier/product edits preserve historical snapshots. Purchase revisions require acknowledgment of existing payments and keep cash history.",
    );
    const expenseInput = {
      title: "Synthetic independent freight",
      categoryId: "international-freight",
      purpose: "Separately payable freight, not included purchase shipping",
      payee: "Synthetic carrier",
      assigneeId: owner.id,
      plannedAt: today,
      dueAt: today,
      timezone: "Australia/Melbourne",
      currency: "AUD",
      amount: 500,
      expectedResult: "Delivered service",
      resultDueAt: today,
      verificationMethod: "Manual evidence",
      paymentMode: "MANUAL",
    };
    const fee = await E.saveExpense(owner, { ...base(), ...expenseInput });
    await E.linkExpense(owner, expenseId, {
      ...base(),
      objectType: "parcel",
      objectId: parcel1.id,
      meaning: "INCLUDED_IN_PURCHASE",
    });
    await E.linkExpense(owner, fee.id, {
      ...base(),
      objectType: "parcel",
      objectId: parcel1.id,
      meaning: "INDEPENDENT_FEE",
    });
    await bad(
      () =>
        E.linkExpense(owner, fee.id, {
          ...base(),
          objectType: "parcel",
          objectId: parcel1.id,
          meaning: "INCLUDED_IN_PURCHASE",
        }),
      400,
    );
    const summary = await Q.expenses(owner, {});
    assert.ok(typeof summary !== "string");
    if (typeof summary !== "string") {
      assert.equal(summary.summary.CNY.obligation, 2400);
      assert.equal(summary.summary.AUD.obligation, 500);
      assert.ok(summary.summary.CNY.missingRates > 0);
      assert.equal(summary.summary.CNY.paid, 1000);
      assert.equal(summary.summary.CNY.refund, 100);
    }
    pass(
      "Included purchase freight references one expense; independent fees are separate. Currency totals remain separate and missing FX is explicitly counted.",
    );
    await E.recordCash(owner, fee.id, {
      ...cash(500, "TEST-" + key()),
      currency: "AUD",
      source: "TEST",
    });
    assert.equal((await Q.expenseDetail(owner, fee.id)).paid, 0);
    await bad(
      () => E.recordCash(owner, fee.id, { ...cash(10, "WRONG-" + key()) }),
      400,
    );
    await bad(
      () =>
        E.recordCash(owner, expenseId, {
          ...cash(10000, "OVERREF-" + key()),
          kind: "REFUND",
        }),
      409,
    );
    const record = await E.recordCash(owner, fee.id, {
      ...cash(200, "MANUAL-" + key()),
      currency: "AUD",
    });
    await E.recordCash(owner, fee.id, {
      ...cash(200, "REV-" + key()),
      currency: "AUD",
      kind: "REVERSAL",
      correctionOf: record.cashId,
    });
    assert.equal((await Q.expenseDetail(owner, fee.id)).paid, 0);
    await bad(
      () =>
        E.recordCash(owner, fee.id, {
          ...cash(200, "REV2-" + key()),
          currency: "AUD",
          kind: "REVERSAL",
          correctionOf: record.cashId,
        }),
      409,
    );
    pass(
      "TEST cash is excluded; cross-currency settlement and excess refunds are rejected. Corrections append one reversal and cannot be repeated.",
    );
    const monthly = {
      anchorDate: new Date("2024-01-31"),
      unit: "MONTH",
      interval: 1,
    };
    assert.equal(C.cycleDate(monthly, 1), "2024-02-29");
    assert.equal(C.cycleDate(monthly, 2), "2024-03-31");
    const annual = {
      anchorDate: new Date("2024-02-29"),
      unit: "YEAR",
      interval: 1,
    };
    assert.equal(C.cycleDate(annual, 1), "2025-02-28");
    assert.equal(C.cycleDate(annual, 4), "2028-02-29");
    assert.equal(C.indexAtOrAfter(monthly, "2024-03-01"), 2);
    const recurringInput = {
      name: "Synthetic domain renewal",
      payee: "Synthetic registrar",
      categoryId: "domain",
      assigneeId: owner.id,
      currency: "AUD",
      amount: 1200,
      unit: "MONTH",
      interval: 1,
      anchorDate: today,
      endDate: null,
      timezone: "Australia/Melbourne",
      reminderDays: 7,
      graceDays: 0,
      paymentMode: "PROVIDER_AUTO",
      expectedResult: "Renewal active",
      verificationMethod: "Registrar confirmation",
      accountAlias: "Synthetic account",
      channel: "Recorded manually",
      tolerance: 10,
      status: "ACTIVE",
    };
    const recurring = await R.saveRecurring(owner, {
      ...base(),
      ...recurringInput,
    });
    await Promise.all([
      runNotificationCheck(undefined, true),
      runNotificationCheck(undefined, true),
    ]);
    const cycles = await db.expense.findMany({
      where: { recurringId: recurring.id },
    });
    assert.equal(cycles.length, 1);
    const pendingCycles = await Q.expenses(owner, {
      linkedType: "subscription",
      linkedId: recurring.id,
    });
    assert.ok(typeof pendingCycles !== "string");
    if (typeof pendingCycles !== "string")
      assert.equal(pendingCycles.items[0].paymentStatus, "UNVERIFIED");
    const cycle = cycles[0];
    await E.recordCash(owner, cycle.id, {
      ...cash(1200, "CYCLE-" + key()),
      currency: "AUD",
    });
    let rule = await db.recurringExpense.findUniqueOrThrow({
      where: { id: recurring.id },
    });
    await R.saveRecurring(owner, {
      ...base(),
      ...recurringInput,
      id: rule.id,
      version: rule.version,
      amount: 1500,
      status: "PAUSED",
    });
    assert.equal(
      (await db.expense.findUniqueOrThrow({ where: { id: cycle.id } })).amount,
      1200,
    );
    rule = await db.recurringExpense.findUniqueOrThrow({
      where: { id: recurring.id },
    });
    await bad(
      () =>
        R.saveRecurring(owner, {
          ...base(),
          ...recurringInput,
          id: rule.id,
          version: rule.version,
        }),
      400,
    );
    await R.saveRecurring(owner, {
      ...base(),
      ...recurringInput,
      id: rule.id,
      version: rule.version,
      resumeFrom: today,
    });
    await runNotificationCheck(undefined, true);
    assert.equal(
      await db.expense.count({ where: { recurringId: recurring.id } }),
      1,
    );
    pass(
      "Month-end/leap-year cycles retain their anchors. Concurrent jobs do not duplicate periods; automatic charges remain unverified, paid history survives rule edits, and resume requires an explicit date.",
    );
    // One overdue purchase, with partial payment, multiple parcels and its linked expense.
    const delayed = await P.savePurchase(owner, {
      ...base(),
      ...purchaseInput,
    });
    const delayedRow = await db.purchase.findUniqueOrThrow({
      where: { id: delayed.id },
    });
    const delayedExpense = await P.confirmPurchase(owner, delayed.id, {
      ...base(),
      version: delayedRow.version,
    });
    await E.recordCash(
      owner,
      delayedExpense.expenseId,
      cash(100, "DELAY-" + key()),
    );
    const dl = await db.purchaseLine.findFirstOrThrow({
      where: { purchaseId: delayed.id },
    });
    const dp = await L.createParcel(owner, {
      ...base(),
      ...parcelInput,
      purchaseId: delayed.id,
      trackingNumber: "DELAY-" + key(),
      lines: [{ variantId: qa.skuIds[0], purchaseLineId: dl.id, quantity: 20 }],
    });
    await runNotificationCheck(undefined, true);
    const delayNotes = await db.notification.findMany({
      where: {
        issueKey: "purchase-arrival:" + delayed.id,
        status: { notIn: ["RESOLVED", "CLOSED"] },
      },
    });
    assert.equal(delayNotes.length, 1);
    assert.equal(delayNotes[0].pinned, true);
    assert.equal(
      await db.notification.count({
        where: { issueKey: "parcel-arrival:" + dp.id },
      }),
      0,
    );
    assert.ok(
      (
        await Q.expenseDetail(owner, delayedExpense.expenseId)
      ).notifications.some((n) => n.id === delayNotes[0].id),
    );
    assert.ok(
      (await L.parcelDetail(owner, dp.id)).notifications.some(
        (n) => n.id === delayNotes[0].id,
      ),
    );
    pass(
      "One paid-purchase delay issue is shared by purchase, expense and parcel details, while independent differences remain separate.",
    );
    const image = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#889988" },
    })
      .png()
      .toBuffer();
    const attachment = (
      await A.uploadAttachments(owner, "expense", expenseId, [
        new File([image], "synthetic-evidence.png", { type: "image/png" }),
      ])
    )[0];
    assert.ok(
      (await A.downloadAttachment(owner, attachment.id)).headers
        .get("content-disposition")
        ?.includes("attachment"),
    );
    await bad(() => A.downloadAttachment(keeper, attachment.id), 403);
    await bad(() => Q.purchaseDetail(keeper, purchase.id), 403);
    await bad(() => Q.expenses(keeper, {}), 403);
    await bad(
      () => R.saveRecurring(keeper, { ...base(), ...recurringInput }),
      403,
    );
    await bad(
      () =>
        A.uploadAttachments(owner, "expense", expenseId, [
          new File(["<svg/>"], "x.png", { type: "image/png" }),
        ]),
      400,
    );
    const receiving = await P.receiptContext(keeper, purchase.id);
    assert.ok(!JSON.stringify(receiving).includes("unitCost"));
    assert.ok(
      !JSON.stringify(await L.parcelDetail(keeper, parcel1.id)).includes(
        "accountAlias",
      ),
    );
    pass(
      "Warehouse access is cost-free and cannot access financial evidence, expense export or recurring writes. Private image validation rejects disguised SVG.",
    );
    const extraPurchase = await P.savePurchase(owner, {
      ...base(),
      ...purchaseInput,
      lines: [
        {
          variantId: qa.skuIds[0],
          quantity: 1,
          unitCost: 100,
          supplierCode: "",
        },
      ],
    });
    const x = await db.purchase.findUniqueOrThrow({
      where: { id: extraPurchase.id },
      include: { lines: true },
    });
    await P.confirmPurchase(owner, x.id, { ...base(), version: x.version });
    const competing = await Promise.allSettled(
      [1, 2].map((n) =>
        P.receivePurchase(owner, x.id, {
          ...base(),
          reference: "CONCURRENT-" + n + "-" + key(),
          occurredAt: now(),
          lines: [{ lineId: x.lines[0].id, sellable: 1, unavailable: 0 }],
        }),
      ),
    );
    assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      await db.purchaseReceipt.count({ where: { purchaseId: x.id } }),
      1,
    );
    pass(
      "Different concurrent acceptance requests competing for one remaining unit permit exactly one inventory effect.",
    );
    await assert.rejects(() =>
      E.saveExpense(owner, { ...base(), ...expenseInput, amount: 1.5 }),
    );
    await assert.rejects(() =>
      P.savePurchase(owner, {
        ...base(),
        ...purchaseInput,
        lines: [{ variantId: qa.skuIds[0], quantity: -1, unitCost: 100 }],
      }),
    );
    await assert.rejects(() =>
      db.cashRecord.update({
        where: { id: record.cashId },
        data: { amount: 1 },
      }),
    );
    pass(
      "Fractional minor-unit amounts, negative quantities and edits to append-only cash records are rejected.",
    );
    await writeFile(
      ".local/business-verification.json",
      JSON.stringify(
        {
          passed: true,
          checks,
          purchaseId: purchase.id,
          expenseId,
          parcelId: parcel1.id,
          recurringId: recurring.id,
          attachmentId: attachment.id,
          returnId: returned.returnId,
          counts: {
            receipts: await db.purchaseReceipt.count(),
            cash: await db.cashRecord.count(),
            expenses: await db.expense.count(),
            parcels: await db.parcel.count(),
          },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log("PASS: " + checks.length + " business verification groups.");
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(
    "Business verification failed:",
    e instanceof Error ? e.message : "unknown error",
  );
  process.exitCode = 1;
});
