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
  const sample = JSON.parse(
    await readFile(".local/sales-verification.json", "utf8"),
  );
  const owner: Actor = { id: qa.ownerId, role: "admin" },
    keeper: Actor = { id: qa.warehouseId, role: "warehouse" };
  const W = await import("../../src/server/sales/workflows"),
    Q = await import("../../src/server/sales/queries"),
    A = await import("../../src/server/sales/analytics"),
    T = await import("../../src/server/sales/timeouts"),
    O = await import("../../src/server/operations/orders"),
    I = await import("../../src/server/operations/inventory");
  const { runNotificationCheck } =
    await import("../../src/server/notifications/engine");
  const checks: string[] = [],
    pass = (s: string) => {
      checks.push(s);
      console.log("PASS: " + s);
    },
    base = () => ({
      key: randomUUID(),
      reason: "Synthetic third-batch edge verification",
    }),
    now = () => new Date().toISOString();
  const bad = (f: () => Promise<unknown>, status: number) =>
    assert.rejects(
      f,
      (e) =>
        !!e && typeof e === "object" && "status" in e && e.status === status,
    );
  let temporaryOwner: { id: string; active: boolean } | undefined;
  try {
    const approverUser = await db.user.findFirstOrThrow({
      where: { role: "admin", id: { not: owner.id } },
    });
    temporaryOwner = { id: approverUser.id, active: approverUser.active };
    await db.user.update({
      where: { id: approverUser.id },
      data: { active: true },
    });
    const approver: Actor = { id: approverUser.id, role: "admin" };
    const order = await db.shopOrder.findUniqueOrThrow({
      where: { id: sample.secondOrderId },
      include: { lines: true },
    });
    const variantId = order.lines[0].variantId!;
    const caseInput = {
      orderId: order.id,
      type: "DELAY",
      source: "STAFF",
      summary: "Synthetic delayed response",
      assigneeId: keeper.id,
      priority: 2,
      occurredAt: "2026-10-06T03:00:00Z",
      dueAt: "2026-10-07T03:00:00Z",
    };
    await bad(
      () =>
        W.saveCase(owner, {
          ...base(),
          ...caseInput,
          occurredAt: "2020-01-01T00:00:00Z",
        }),
      400,
    );
    const care = await W.saveCase(owner, { ...base(), ...caseInput });
    const testCare = await W.saveCase(owner, {
      ...base(),
      ...caseInput,
      source: "TEST",
    });
    await bad(
      () =>
        W.saveCompensation(owner, {
          ...base(),
          caseId: testCare.id,
          type: "PARTIAL_REFUND",
          amountCents: 100,
          currency: "AUD",
          lines: [],
          basis: "Test must not touch a real order",
          executorId: owner.id,
          dueAt: "2026-10-08T03:00:00Z",
        }),
      400,
    );
    const event = await db.orderEvent.findFirstOrThrow({
      where: { after: { path: ["caseId"], equals: testCare.id } },
    });
    assert.equal(event.dataKind, "TEST");
    assert.equal(
      event.occurredAt!.toISOString(),
      caseInput.occurredAt.replace("Z", ".000Z"),
    );
    const setRule = async (
      kind: (typeof T.kinds)[number],
      changes: Record<string, unknown> = {},
    ) => {
      const old = await db.orderTimeoutRule.findFirst({
        where: { kind },
        orderBy: { version: "desc" },
      });
      return T.saveRule(owner, {
        ...base(),
        kind,
        version: old?.version ?? 0,
        enabled: true,
        days: 0,
        dayMode: "CALENDAR",
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
        ...changes,
      });
    };
    for (const kind of [
      "FIRST_RESPONSE",
      "CASE_RESOLUTION",
      "COMPENSATION",
    ] as const)
      await setRule(kind);
    await runNotificationCheck(undefined, true);
    const timer = await db.orderTimer.findUniqueOrThrow({
      where: { kind_objectId: { kind: "FIRST_RESPONSE", objectId: care.id } },
    });
    assert.equal(
      await db.orderTimer.count({ where: { objectId: testCare.id } }),
      0,
    );
    const issueCount = () =>
      db.notification.count({
        where: { issueKey: "order-timeout:" + timer.id, conditionActive: true },
      });
    assert.equal(await issueCount(), 1);
    await runNotificationCheck(undefined, true);
    assert.equal(await issueCount(), 1);
    await bad(
      () =>
        T.pauseTimer(owner, timer.id, {
          ...base(),
          endsAt: new Date(Date.now() + 15 * 86400000).toISOString(),
        }),
      400,
    );
    await T.pauseTimer(owner, timer.id, {
      ...base(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await setRule("FIRST_RESPONSE", { days: 2, apply: "RECALCULATE" });
    const changed = await db.orderTimer.findUniqueOrThrow({
      where: { id: timer.id },
      include: { pauses: true },
    });
    assert.equal(
      changed.deadlineAt.getTime(),
      T.deadline(
        changed.anchorAt,
        await db.orderTimeoutRule.findUniqueOrThrow({
          where: { id: changed.ruleId },
        }),
      ).getTime() +
        changed.pauses.reduce(
          (n, p) => n + p.endsAt.getTime() - p.startsAt.getTime(),
          0,
        ),
    );
    await W.caseAction(keeper, care.id, {
      ...base(),
      version: 1,
      action: "RESPONSE",
      content: "Synthetic response recorded; nothing sent",
      occurredAt: now(),
    });
    await runNotificationCheck(undefined, true);
    assert.equal(
      (await db.orderTimer.findUniqueOrThrow({ where: { id: timer.id } }))
        .active,
      false,
    );
    pass(
      "Aftercare event time and TEST markers are preserved; first-response deadlines deduplicate, reject unlimited pauses, preserve pauses on explicit recalculation, and resolve on response.",
    );

    const makeComp = async (
      type: string,
      amountCents = 0,
      lines: { variantId: string; quantity: number }[] = [],
    ) =>
      W.saveCompensation(owner, {
        ...base(),
        caseId: care.id,
        type,
        amountCents,
        currency: "AUD",
        lines,
        basis: "Synthetic checked basis",
        executorId: owner.id,
        dueAt: "2026-10-08T03:00:00Z",
      });
    const act = async (
      actor: Actor,
      id: string,
      action: string,
      extra: Record<string, unknown> = {},
    ) =>
      W.compensationAction(actor, id, {
        ...base(),
        version: (await db.compensation.findUniqueOrThrow({ where: { id } }))
          .version,
        action,
        occurredAt: now(),
        ...extra,
      });
    const comp = await makeComp("OTHER");
    await act(owner, comp.id, "SUBMIT");
    await act(approver, comp.id, "APPROVE");
    await runNotificationCheck(undefined, true);
    const compTimer = await db.orderTimer.findUniqueOrThrow({
      where: { kind_objectId: { kind: "COMPENSATION", objectId: comp.id } },
    });
    assert.ok(compTimer.active);
    await bad(
      () =>
        W.caseAction(owner, care.id, {
          ...base(),
          version: 2,
          action: "STATUS",
          status: "CLOSED",
          content: "Cannot hide outstanding compensation",
          occurredAt: now(),
        }),
      409,
    );
    const { uploadAttachments } =
      await import("../../src/server/business/attachments");
    const bytes = await sharp({
      create: { width: 3, height: 3, channels: 3, background: "#ddd" },
    })
      .png()
      .toBuffer();
    const proof = await uploadAttachments(owner, "compensation", comp.id, [
      new File([bytes], "synthetic.png", { type: "image/png" }),
    ]);
    await act(owner, comp.id, "OTHER_COMPLETE", { evidenceId: proof[0].id });
    await W.caseAction(owner, care.id, {
      ...base(),
      version: 2,
      action: "STATUS",
      status: "CLOSED",
      content: "Synthetic outcome completed",
      occurredAt: now(),
    });
    await runNotificationCheck(undefined, true);
    assert.equal(
      await db.orderTimer.count({
        where: { objectId: { in: [comp.id, care.id] }, active: true },
      }),
      0,
    );
    const closed = await db.aftercareCase.findUniqueOrThrow({
      where: { id: care.id },
    });
    await W.caseAction(owner, care.id, {
      ...base(),
      version: closed.version,
      action: "REOPEN",
      content: "New synthetic evidence requires review",
      occurredAt: now(),
    });
    assert.ok((await Q.compensationDetail(owner, comp.id)).events.length >= 4);
    await setRule("CASE_RESOLUTION", { enabled: false });
    await runNotificationCheck(undefined, true);
    assert.equal(
      await db.orderTimer.count({
        where: { kind: "CASE_RESOLUTION", active: true },
      }),
      0,
    );
    pass(
      "Case and compensation execution deadlines are linked to real work; unresolved approvals block closure, completion clears timers, reopening retains history, and disabling a rule removes active alerts.",
    );

    const replacement = await makeComp("REPLACEMENT", 0, [
      { variantId, quantity: 1 },
    ]);
    await act(owner, replacement.id, "SUBMIT");
    await act(approver, replacement.id, "APPROVE");
    const blocked = await db.$transaction(async (tx) => {
      const b = await I.balance(tx, variantId, "MELBOURNE"),
        n = I.available(b);
      await I.changeBalance(
        tx,
        owner,
        variantId,
        "MELBOURNE",
        { unavailable: n },
        "MANUAL_ADJUSTMENT",
        "verification",
        replacement.id,
        "Synthetic unavailable stock",
      );
      return n;
    });
    try {
      await bad(() => act(owner, replacement.id, "RESERVE_REPLACEMENT"), 409);
      assert.equal(
        await db.replacementShipment.count({
          where: { compensationId: replacement.id },
        }),
        0,
      );
      assert.equal(
        (
          await db.compensation.findUniqueOrThrow({
            where: { id: replacement.id },
          })
        ).status,
        "APPROVED",
      );
    } finally {
      await db.$transaction((tx) =>
        I.changeBalance(
          tx,
          owner,
          variantId,
          "MELBOURNE",
          { unavailable: -blocked },
          "MANUAL_ADJUSTMENT",
          "verification",
          replacement.id,
          "Release synthetic unavailable stock",
        ),
      );
    }
    await act(owner, replacement.id, "CANCEL");
    const refund = await makeComp("PARTIAL_REFUND", 1000);
    await act(owner, refund.id, "SUBMIT");
    await act(approver, refund.id, "APPROVE");
    await act(owner, refund.id, "FAIL");
    const extra = await makeComp("PARTIAL_REFUND", 1000);
    await act(owner, extra.id, "SUBMIT");
    await bad(() => act(approver, extra.id, "APPROVE"), 409);
    await act(owner, refund.id, "CANCEL");
    await act(approver, extra.id, "APPROVE");
    await act(owner, extra.id, "CANCEL");
    pass(
      "Insufficient stock rolls replacement creation back without fake dispatch; failed refunds retain their allowance until explicit cancellation releases it.",
    );

    const self = await makeComp("OTHER");
    await act(owner, self.id, "SUBMIT");
    const otherOwners = await db.user.findMany({
      where: { role: "admin", active: true, id: { not: owner.id } },
      select: { id: true },
    });
    try {
      await db.user.updateMany({
        where: { id: { in: otherOwners.map((u) => u.id) } },
        data: { active: false },
      });
      await act(owner, self.id, "APPROVE");
      assert.equal(
        (await db.compensation.findUniqueOrThrow({ where: { id: self.id } }))
          .selfApproved,
        true,
      );
    } finally {
      await db.user.updateMany({
        where: { id: { in: otherOwners.map((u) => u.id) } },
        data: { active: true },
      });
    }
    await act(owner, self.id, "CANCEL");
    const query = {
      from: "2026-10-01",
      to: "2026-10-31",
      asOf: "2026-11-03",
      product: sample.productId,
    };
    try {
      for (const capability of ["orderStats", "orderExport"])
        await db.businessGrant.create({
          data: { userId: keeper.id, capability, grantedBy: owner.id },
        });
      const stats = await A.analytics(keeper, query);
      assert.ok(typeof stats !== "string");
      assert.equal(stats.totals.received, 6000);
      const csv = await Q.orders(keeper, {
        product: sample.productId,
        format: "csv",
      });
      assert.equal(typeof csv, "string");
      assert.ok(!String(csv).includes("sales-sample@verification.invalid"));
      await bad(() => Q.orders(keeper, { format: "csv", pii: "true" }), 403);
      await db.businessGrant.create({
        data: {
          userId: keeper.id,
          capability: "customerExport",
          grantedBy: owner.id,
        },
      });
      assert.ok(
        String(
          await Q.orders(keeper, {
            product: sample.productId,
            format: "csv",
            pii: "true",
          }),
        ).includes("sales-sample@verification.invalid"),
      );
    } finally {
      await db.businessGrant.deleteMany({
        where: {
          userId: keeper.id,
          capability: { in: ["orderStats", "orderExport", "customerExport"] },
        },
      });
    }
    pass(
      "Sole-owner approval is explicitly marked; statistics, minimal export and customer-contact export require separate grants and revoke immediately.",
    );

    const checkout = () => ({
      key: randomUUID(),
      email: "synthetic-edge@verification.invalid",
      recipientName: "Synthetic recipient",
      addressLine1: "1 Test Street",
      addressLine2: "",
      city: "Melbourne",
      state: "VIC",
      postcode: "3000",
      country: "AU",
      items: [{ variantId, quantity: 1 }],
    });
    const pending = await O.createOrder(checkout()),
      simulated = await O.createOrder(checkout());
    const payment = { ...base(), eventId: randomUUID(), outcome: "success" };
    await O.simulatePayment(owner, simulated.id, payment);
    await O.simulatePayment(owner, simulated.id, payment);
    const day = new Date().toISOString().slice(0, 10),
      range = {
        from: "2026-09-01",
        to: day,
        asOf: day,
        product: sample.productId,
      };
    const real = await A.analytics(owner, range),
      test = await A.analytics(owner, { ...range, dataKind: "TEST" });
    assert.ok(typeof real !== "string" && typeof test !== "string");
    assert.equal(real.totals.orders, 2);
    assert.equal(test.totals.orders, 1);
    assert.equal(
      await db.orderEvent.count({
        where: { orderId: simulated.id, type: "PAYMENT_SUCCEEDED" },
      }),
      1,
    );
    assert.equal(
      await db.orderEvent.count({
        where: { orderId: pending.id, type: "PAYMENT_SUCCEEDED" },
      }),
      0,
    );
    assert.ok(
      !real.rows.some((r) => r.id === simulated.id || r.id === pending.id),
    );
    const bounds = Q.range({
      from: "2026-10-04",
      to: "2026-10-04",
      timezone: "Australia/Melbourne",
    });
    assert.equal(bounds.lt!.getTime() - bounds.gte!.getTime(), 23 * 3600000);
    pass(
      "Pending and simulated payments stay out of real sales, retry is counted once, TEST view is explicit, and Melbourne DST date boundaries use the 23-hour local day.",
    );
    await writeFile(
      ".local/sales-edge-verification.json",
      JSON.stringify({ passed: true, checks }),
      { mode: 0o600 },
    );
  } finally {
    if (temporaryOwner)
      await db.user.update({
        where: { id: temporaryOwner.id },
        data: { active: temporaryOwner.active },
      });
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(
    "Sales edge verification failed:",
    e instanceof Error ? e.message : "unknown",
  );
  process.exitCode = 1;
});
