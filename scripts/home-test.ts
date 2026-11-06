import assert from "node:assert/strict";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { defaultLayout, newWidget } from "../src/lib/home-layout";
import { dateBounds, localDay } from "../src/server/notifications/time";

async function main() {
  config({ path: ".local/operations-test.env", quiet: true });
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/forme_operations_test",
    "Only the existing isolated test database is supported; this script never resets it.",
  );
  const { database } = await import("../src/server/db"),
    db = database();
  const H = await import("../src/server/home/service");
  const N = await import("../src/server/notifications/service");
  const Q = await import("../src/server/operations/queries");
  const B = await import("../src/server/business/queries");
  const S = await import("../src/server/sales/queries");
  const A = await import("../src/server/sales/analytics");
  const checks: string[] = [];
  const pass = (text: string) => {
    checks.push(text);
    console.log("PASS: " + text);
  };
  const bad = (fn: () => Promise<unknown>, code: number) =>
    assert.rejects(
      fn,
      (e: unknown) =>
        !!e && typeof e === "object" && "status" in e && e.status === code,
    );
  const now = new Date(),
    day = localDay(now, "Australia/Melbourne"),
    todayBounds = dateBounds(day, "Australia/Melbourne");
  const prefix = "home-qa-v1";
  let credentials: {
    password: string;
    ownerId: string;
    keeperId: string;
    ownerEmail: string;
    keeperEmail: string;
  };
  try {
    credentials = JSON.parse(await readFile(".local/home-qa.json", "utf8"));
  } catch {
    credentials = {
      password: randomUUID() + "A!",
      ownerId: prefix + "-owner",
      keeperId: prefix + "-keeper",
      ownerEmail: "home.owner@example.invalid",
      keeperEmail: "home.keeper@example.invalid",
    };
  }
  const owner = { id: credentials.ownerId, role: "admin" as const },
    keeper = { id: credentials.keeperId, role: "warehouse" as const };
  try {
    for (const [actor, email, name] of [
      [owner, credentials.ownerEmail, "Home QA Owner"],
      [keeper, credentials.keeperEmail, "Home QA Warehouse"],
    ] as const) {
      if (!(await db.user.findUnique({ where: { id: actor.id } })))
        await db.user.create({
          data: {
            id: actor.id,
            email,
            name,
            emailVerified: true,
            role: actor.role,
            accounts: {
              create: {
                id: randomUUID(),
                providerId: "credential",
                accountId: actor.id,
                password: await hashPassword(credentials.password),
              },
            },
          },
        });
    }
    await writeFile(".local/home-qa.json", JSON.stringify(credentials), {
      mode: 0o600,
    });
    const initialOwner = await H.homeMetadata(owner),
      initialKeeper = await H.homeMetadata(keeper);
    assert(initialOwner.widgets.some((w) => w.type === "notifications"));
    assert(
      !initialKeeper.catalogue.some((w) =>
        ["sales", "expenses", "trend"].includes(w.type),
      ),
    );
    const layout = [
      ...defaultLayout(owner).slice(1),
      newWidget("inventory", "second-stock"),
    ];
    const saved = await H.saveHomeLayout(owner, {
      version: 1,
      revision: initialOwner.revision,
      widgets: layout,
    });
    assert.deepEqual((await H.homeMetadata(owner)).widgets, layout);
    assert.deepEqual(
      (await H.homeMetadata(keeper)).widgets,
      initialKeeper.widgets,
    );
    await bad(
      () =>
        H.saveHomeLayout(owner, {
          version: 1,
          revision: initialOwner.revision,
          widgets: layout,
        }),
      409,
    );
    await assert.rejects(() =>
      H.saveHomeLayout(owner, {
        version: 1,
        revision: saved.revision,
        widgets: layout.filter((w) => w.type !== "notifications"),
      }),
    );
    await bad(() => H.homeData(keeper, [newWidget("sales", "s")]), 403);
    await bad(
      () =>
        H.homeData(keeper, [
          { ...newWidget("inventory", "bj"), config: { warehouse: "BEIJING" } },
        ]),
      403,
    );
    pass(
      "Role defaults, own-account persistence, two-account isolation, optimistic conflict and mandatory notification card",
    );
    await db.businessGrant.upsert({
      where: {
        userId_capability: { userId: keeper.id, capability: "orderStats" },
      },
      create: {
        userId: keeper.id,
        capability: "orderStats",
        grantedBy: owner.id,
      },
      update: {},
    });
    assert(
      (await H.homeMetadata(keeper)).catalogue.some((w) => w.type === "sales"),
    );
    await db.businessGrant.delete({
      where: {
        userId_capability: { userId: keeper.id, capability: "orderStats" },
      },
    });
    await bad(
      () =>
        H.homeData({ ...keeper, capabilities: ["orderStats"] }, [
          newWidget("sales", "s"),
        ]),
      403,
    );
    await db.notificationPreference.update({
      where: { userId: owner.id },
      data: { homeVersion: 99, homeLayout: { invalid: true } },
    });
    assert((await H.homeMetadata(owner)).recovered);
    const recovered = await H.homeMetadata(owner);
    await H.saveHomeLayout(owner, {
      version: 1,
      revision: recovered.revision,
      widgets: defaultLayout(owner),
    });
    pass(
      "Revoked grants override stale actor capabilities immediately; unknown layout version recovers safely",
    );

    const product = await db.product.upsert({
      where: { id: prefix + "-product" },
      create: {
        id: prefix + "-product",
        slug: prefix + "-product",
        name: "Home QA sample ring",
        categoryId: "rings",
        status: "PUBLISHED",
        publishedAt: now,
      },
      update: {},
    });
    const sku = await db.productVariant.upsert({
      where: { id: prefix + "-sku" },
      create: {
        id: prefix + "-sku",
        productId: product.id,
        sku: "HOME-QA-RING",
        priceCents: 4900,
      },
      update: {},
    });
    for (let i = 0; i < 7; i++) {
      const recordDay = H.shiftDay(day, -i),
        start = dateBounds(recordDay, "Australia/Melbourne").gte;
      const paidAt = i
        ? new Date(start.getTime() + 12 * 3600000)
        : new Date(Math.max(start.getTime(), now.getTime() - 120000));
      const id = prefix + "-order-" + day + "-" + i,
        amount = [4900, 5900, 9800, 4900, 14700, 6900, 8800][i];
      await db.shopOrder.upsert({
        where: { id },
        create: {
          id,
          number: "HOME-QA-" + day + "-" + i,
          email: "sample@example.invalid",
          recipientName: "Synthetic Home QA",
          addressLine1: "1 Test Street",
          city: "Melbourne",
          state: "VIC",
          postcode: "3000",
          subtotalCents: amount,
          discountCents: 1000,
          actualDiscountCents: 1000,
          shippingCents: 800,
          totalCents: amount + 800,
          dataKind: "REAL",
          paymentStatus: "PAID",
          paidAt,
          expiresAt: now,
          lines: {
            create: {
              variantId: sku.id,
              productId: product.id,
              productName: product.name,
              sku: sku.sku,
              size: "M",
              color: "Silver",
              categoryId: "rings",
              categoryName: "Rings",
              collections: [],
              quantity: 1,
              originalUnitCents: amount + 1000,
              unitPriceCents: amount,
              discountCents: 1000,
              actualDiscountCents: 1000,
              discountSource: "MARKDOWN",
              pricingBasis: "CHECKOUT_SNAPSHOT",
              lineTotalCents: amount,
            },
          },
        },
        update: { paidAt },
      });
      if (!(await db.orderEvent.findUnique({ where: { eventKey: id } })))
        await db.orderEvent.create({
          data: {
            orderId: id,
            type: "PAYMENT_SUCCEEDED",
            dataKind: "REAL",
            source: "MANUAL",
            occurredAt: paidAt,
            actorId: owner.id,
            objectType: "order",
            objectId: id,
            eventKey: id,
            amountCents: amount + 800,
          },
        });
    }
    const template = await db.shopOrder.findUniqueOrThrow({
      where: { id: prefix + "-order-" + day + "-0" },
    });
    const testId = prefix + "-test-order-" + day;
    await db.shopOrder.upsert({
      where: { id: testId },
      create: {
        ...template,
        id: testId,
        number: "HOME-QA-TEST-EXCLUDED-" + day,
        dataKind: "TEST",
        subtotalCents: 999999,
        shippingCents: 0,
        discountCents: 0,
        actualDiscountCents: 0,
        totalCents: 999999,
        lines: {
          create: {
            variantId: sku.id,
            productId: product.id,
            productName: product.name,
            sku: sku.sku,
            size: "M",
            color: "Silver",
            categoryId: "rings",
            categoryName: "Rings",
            collections: [],
            quantity: 1,
            originalUnitCents: 999999,
            unitPriceCents: 999999,
            discountCents: 0,
            discountSource: "NONE",
            lineTotalCents: 999999,
          },
        },
      },
      update: { paidAt: template.paidAt },
    });
    if (!(await db.orderEvent.findUnique({ where: { eventKey: testId } })))
      await db.orderEvent.create({
        data: {
          orderId: testId,
          type: "PAYMENT_SUCCEEDED",
          source: "TEST",
          dataKind: "TEST",
          occurredAt: template.paidAt,
          objectType: "order",
          objectId: testId,
          eventKey: testId,
          amountCents: 999999,
        },
      });
    const category = await db.expenseCategory.upsert({
      where: { id: prefix + "-category" },
      create: { id: prefix + "-category", name: "Home QA" },
      update: {},
    });
    for (const [suffix, currency, amount, offset, source] of [
      ["aud", "AUD", 2000, 0, "MANUAL"],
      ["cny", "CNY", 10000, 3, "MANUAL"],
      ["test", "AUD", 900000, 0, "TEST"],
    ] as const) {
      const dueAt = new Date(H.shiftDay(day, offset));
      await db.expense.upsert({
        where: { id: prefix + "-expense-" + suffix },
        create: {
          id: prefix + "-expense-" + suffix,
          number: "HOME-QA-" + suffix,
          title: "Home QA sample " + currency,
          categoryId: category.id,
          purpose: "Synthetic Home validation",
          payee: "Sample supplier",
          createdBy: owner.id,
          assigneeId: owner.id,
          plannedAt: dueAt,
          dueAt,
          currency,
          amount,
          source,
          expectedResult: "QA outcome",
          resultDueAt: dueAt,
          verificationMethod: "Synthetic evidence",
          timezone: "Australia/Melbourne",
        },
        update: { dueAt, plannedAt: dueAt, resultDueAt: dueAt },
      });
    }
    if (!(await db.cashRecord.findUnique({ where: { id: prefix + "-cash" } })))
      await db.cashRecord.create({
        data: {
          id: prefix + "-cash",
          expenseId: prefix + "-expense-aud",
          kind: "PAYMENT",
          amount: 500,
          currency: "AUD",
          occurredAt: now,
          actorId: owner.id,
          source: "MANUAL",
          accountAlias: "QA",
          channel: "QA",
          reference: prefix,
          reason: "Synthetic partial payment",
        },
      });
    const linkedExpenseId = prefix + "-linked-test-expense-" + day;
    await db.expense.upsert({
      where: { id: linkedExpenseId },
      create: {
        id: linkedExpenseId,
        number: "HOME-QA-LINKED-TEST-" + day,
        title: "Synthetic expense linked to TEST order",
        categoryId: category.id,
        purpose: "Verify linked test provenance",
        payee: "Sample customer",
        createdBy: owner.id,
        assigneeId: owner.id,
        plannedAt: new Date(day),
        dueAt: new Date(day),
        currency: "AUD",
        amount: 930000,
        source: "MANUAL",
        expectedResult: "QA only",
        resultDueAt: new Date(day),
        verificationMethod: "Synthetic evidence",
        links: { create: { objectType: "order", objectId: testId } },
      },
      update: {},
    });
    const linkedReal = await B.expenses(owner, {
      dataKind: "REAL",
      q: "HOME-QA-LINKED-TEST-" + day,
    });
    const linkedTest = await B.expenses(owner, {
      dataKind: "TEST",
      q: "HOME-QA-LINKED-TEST-" + day,
    });
    assert(typeof linkedReal !== "string" && linkedReal.total === 0);
    assert(typeof linkedTest !== "string" && linkedTest.total === 1);
    const parcelData = {
      type: "OTHER",
      assigneeId: keeper.id,
      sourcePlace: "Sample origin",
      destinationPlace: "Melbourne",
      warehouse: "MELBOURNE" as const,
      timezone: "Australia/Melbourne",
      sender: "Sample sender",
      recipient: "Sample recipient",
      carrier: "Sample carrier",
      packageCount: 4,
      transportStatus: "IN_TRANSIT",
      dispatchedAt: new Date(now.getTime() - 86400000),
      etaEnd: new Date(day),
      createdBy: owner.id,
    };
    await db.parcel.upsert({
      where: { id: prefix + "-parcel" },
      create: {
        ...parcelData,
        id: prefix + "-parcel",
        number: "HOME-QA-PARCEL",
        lines: { create: { variantId: sku.id, quantity: 1 } },
      },
      update: { etaEnd: new Date(day) },
    });
    pass(
      "Prepared additive synthetic sales, TEST-exclusion, partial payment, multi-currency and four-box/one-parcel-record fixtures only in isolated database",
    );

    let notificationVersion = 1;
    for (let i = 0; i < 9; i++) {
      const id = prefix + "-notification-" + i;
      const prior = await db.notification.findUnique({ where: { id } });
      const version = (prior?.version ?? 0) + 1;
      if (i === 0) notificationVersion = version;
      const createdAt =
        i === 8 ? now : new Date(todayBounds.gte.getTime() - 86400000 * 2);
      await db.notification.upsert({
        where: { id },
        create: {
          id,
          issueKey: id,
          cycle: 1,
          type: "INVENTORY",
          severity: 2,
          title: "Home QA stock follow-up " + i,
          reason:
            "Synthetic stock review; acknowledge separately from resolving.",
          action: "Review Stock and record the outcome",
          objectType: "sku",
          objectId: sku.id,
          warehouse: "MELBOURNE",
          pinned: i !== 8,
          systemPin: true,
          assigneeId: keeper.id,
          recipientIds: [owner.id, keeper.id],
          confirmerIds: [owner.id, keeper.id],
          fingerprint: id,
          rule: "home-qa",
          ruleVersion: 1,
          ruleSnapshot: {},
          snapshot: { available: 0 },
          currentData: { available: 0 },
          occurredAt: createdAt,
          createdAt,
        },
        update: { pinned: i !== 8, status: "OPEN", createdAt, version },
      });
    }
    const notificationId = prefix + "-notification-0";
    await db.notificationReceipt.create({
      data: {
        notificationId,
        userId: owner.id,
        version: notificationVersion,
        kind: "ACK",
      },
    });
    const notices = await N.listNotifications(keeper, {
      view: "today",
      dataKind: "REAL",
      day,
    });
    assert.equal(
      new Set(notices.items.map((n) => n.id)).size,
      notices.items.length,
    );
    assert(
      notices.items.some((n) => n.id === notificationId && n.confirmed === 1),
    );
    assert(notices.items.some((n) => n.id === prefix + "-notification-8"));
    const response = await H.homeData(owner, defaultLayout(owner), now);
    assert(
      response.results.every((r) => !["error", "forbidden"].includes(r.status)),
      JSON.stringify(response.results.filter((r) => r.status === "error")),
    );
    const notificationWidget = (
      await H.homeData(keeper, [newWidget("notifications", "n")], now)
    ).results[0].data!.notifications!;
    assert(notificationWidget.hiddenPinned > 0);
    assert.equal(
      notificationWidget.hiddenPinned,
      notices.pinnedTotal -
        notificationWidget.items.filter((n) => n.pinned).length,
    );
    const act = (action: string) => ({
      key: randomUUID(),
      version: notificationVersion,
      action,
      reason: "Synthetic Home workflow verification",
    });
    await bad(
      () => N.actNotification(owner, notificationId, act("unpin")),
      409,
    );
    await N.actNotification(keeper, notificationId, act("ack"));
    assert.equal(
      (await N.notificationDetail(keeper, notificationId)).status,
      "OPEN",
    );
    await bad(
      () => N.actNotification(owner, notificationId, act("unpin")),
      409,
    );
    await N.actNotification(owner, notificationId, act("resolve"));
    await N.actNotification(owner, notificationId, act("unpin"));
    assert.equal(
      (await N.notificationDetail(owner, notificationId)).pinned,
      false,
    );
    pass(
      "Today plus cross-day pinned union, no duplicate IDs, all hidden pins counted, 1/2 confirmation, acknowledge != resolve, guarded unpin",
    );

    for (const result of response.results) {
      for (const m of result.data?.metrics || []) {
        const url = new URL(m.href, "http://local"),
          query = Object.fromEntries(url.searchParams);
        delete query.section;
        let value: number | null | undefined;
        if (url.pathname.endsWith("operations"))
          value = (await Q.inventoryList(owner, query)).total;
        else if (
          url.pathname.endsWith("sales") &&
          url.searchParams.get("section") === "orders"
        )
          value = ((await S.orders(owner, query)) as { total: number }).total;
        else if (url.pathname.endsWith("sales")) {
          const data = await A.analytics(owner, query);
          assert.notEqual(typeof data, "string");
          if (typeof data !== "string")
            value =
              m.key === "orders"
                ? data.totals.orders || null
                : data.totals.orders
                  ? data.totals.merchandise
                  : null;
        } else if (url.searchParams.get("section") === "expenses") {
          const data = await B.expenses(owner, query);
          assert.notEqual(typeof data, "string");
          if (typeof data !== "string")
            value =
              m.emptyLabel && !data.total
                ? null
                : m.currency
                  ? data.summary[m.currency]?.outstanding
                  : data.total;
        } else {
          const data = await B.logistics(owner, query);
          if (typeof data !== "string") value = data.total;
        }
        assert.equal(m.value, value, "Drill-through mismatch: " + m.key);
      }
    }
    const todaySale = response.results.find(
      (r) => r.id === "default-sales",
    )!.data!;
    assert.equal(todaySale.metrics[0].value, 4900);
    assert.equal(todaySale.metrics[1].value, 1);
    const expenseData = response.results.find(
      (r) => r.id === "default-expenses",
    )!.data!;
    assert(
      expenseData.metrics.some(
        (m) => m.currency === "CNY" && m.value === 10000,
      ),
    );
    assert(!expenseData.metrics.some((m) => m.value === 900000));
    const parcels = await B.logistics(owner, {
      q: "HOME-QA-PARCEL",
      source: "PARCEL",
      inTransit: "true",
      dataKind: "REAL",
    });
    assert(typeof parcels !== "string" && parcels.total === 1);
    pass(
      "Every metric matches its linked business filter; merchandise excludes shipping/refunds and TEST payments; expense currencies remain separate; package count is not parcel count",
    );

    await N.savePreference(owner, { timezone: "Asia/Shanghai" });
    assert.equal((await H.homeMetadata(owner)).timezone, "Asia/Shanghai");
    await N.savePreference(owner, { timezone: "Australia/Melbourne" });
    await writeFile(
      ".local/home-verification.json",
      JSON.stringify(
        {
          at: new Date(),
          checks,
          notificationId,
          ownerId: owner.id,
          keeperId: keeper.id,
        },
        null,
        2,
      ),
    );
    pass(
      "Existing personal timezone preference is reused without changing layout",
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Home verification failed",
  );
  process.exitCode = 1;
});
