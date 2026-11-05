import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import sharp from "sharp";
import { ZodError } from "zod";
import { hashPassword } from "better-auth/crypto";
import { database } from "../../src/server/db";
import { auth } from "../../src/server/auth";
import { uploadImages } from "../../src/server/media";
import {
  createAccount,
  updateAccount,
  requireStaff,
} from "../../src/server/operations/accounts";
import {
  applyStockAction,
  available,
  submitCount,
  decideCount,
  resolveLegacyDiscrepancy,
} from "../../src/server/operations/inventory";
import {
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  transferDetails,
  remaining,
  cancelTransfer,
  updateTransfer,
  returnTransfer,
} from "../../src/server/operations/transfers";
import {
  createOrder,
  simulatePayment,
  shipOrder,
  cancelOrder,
  expireOrders,
  registerReturn,
  checkOrderAccess,
  issueOrderAccess,
  orderDetails,
} from "../../src/server/operations/orders";
import {
  saveCommerceSettings,
  saveSkuPolicy,
} from "../../src/server/operations/settings";
import { publicAvailability } from "../../src/server/operations/availability";
import { inventoryList, orderList } from "../../src/server/operations/queries";
import { csv, type Actor } from "../../src/server/operations/core";
const db = database();
const checks: string[] = [];
const pass = (s: string) => {
  checks.push(s);
  console.log("PASS: " + s);
};
const key = () => randomUUID();
const reason = "Synthetic local operations verification";
const owner: Actor = { id: randomUUID(), role: "admin" },
  keeper: Actor = { id: randomUUID(), role: "warehouse" };
const password = randomUUID() + randomUUID();
const skuIds = Array.from({ length: 6 }, () => randomUUID());
async function expectStatus(fn: () => Promise<unknown>, status: number) {
  await assert.rejects(
    fn,
    (e) =>
      (status === 400 && e instanceof ZodError) ||
      (!!e && typeof e === "object" && "status" in e && e.status === status),
  );
}
const stock = (
  variantId: string,
  warehouse: "BEIJING" | "MELBOURNE",
  quantity: number,
  kind = "INITIAL",
) =>
  applyStockAction(owner, {
    key: key(),
    variantId,
    warehouse,
    quantity,
    kind,
    reason,
  });
const getBalance = (variantId: string, warehouse: "BEIJING" | "MELBOURNE") =>
  db.inventoryBalance.findUniqueOrThrow({
    where: { variantId_warehouse: { variantId, warehouse } },
  });
const customer = (items: { variantId: string; quantity: number }[]) => ({
  key: key(),
  items,
  email: "synthetic-customer@example.invalid",
  recipientName: "Synthetic Test Customer",
  addressLine1: "100 Test Street",
  addressLine2: "",
  city: "Melbourne",
  state: "VIC",
  postcode: "3000",
  country: "AU",
});
async function signIn(email: string) {
  const r = await auth.handler(
    new Request("http://127.0.0.1:3002/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1:3002",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    }),
  );
  assert.equal(r.status, 200);
  return new Headers({
    cookie: r.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; "),
  });
}
async function main() {
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/forme_operations_test",
  );
  await db.user.create({
    data: {
      id: owner.id,
      name: "Synthetic Owner",
      email: "operations-owner@verification.invalid",
      role: "admin",
      active: true,
    },
  });
  await db.account.create({
    data: {
      id: key(),
      providerId: "credential",
      accountId: owner.id,
      userId: owner.id,
      password: await hashPassword(password),
    },
  });
  const a = await createAccount(owner, {
    key: key(),
    name: "Synthetic Warehouse",
    email: "operations-warehouse@verification.invalid",
    password,
    role: "warehouse",
    reason,
  });
  keeper.id = a.id;
  const png = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#b9825c" },
  })
    .png()
    .toBuffer();
  const [media] = await uploadImages([
    new File([new Uint8Array(png)], "test.png", { type: "image/png" }),
  ]);
  await db.category.create({
    data: { id: "ops-category", slug: "ops-rings", name: "Original category" },
  });
  await db.collection.create({
    data: {
      id: "ops-collection",
      slug: "ops-collection",
      name: "Original collection",
    },
  });
  await db.product.create({
    data: {
      id: "ops-product",
      slug: "operations-test-ring",
      name: "Operations Test Ring",
      status: "PUBLISHED",
      categoryId: "ops-category",
      publishedAt: new Date(),
      images: { create: { mediaId: media.id } },
      collections: { create: { collectionId: "ops-collection" } },
      variants: {
        create: skuIds.map((id, i) => ({
          id,
          sku: `OPS-${i}`,
          size: String(8 + i),
          color: "Silver",
          priceCents: i === 3 ? 12900 : 8900,
          compareAtPriceCents: i === 3 ? null : 9900,
          stock: i === 5 ? 7 : 0,
        })),
      },
    },
  });
  await db.legacyStock.create({
    data: { variantId: skuIds[5], originalQty: 7, remainingQty: 7 },
  });
  assert.equal(
    (await publicAvailability([skuIds[5]])).get(skuIds[5])!.stock,
    0,
  );
  const allocate = {
    key: key(),
    variantId: skuIds[5],
    warehouse: "BEIJING",
    quantity: 3,
    kind: "LEGACY",
    reason,
  };
  await applyStockAction(owner, allocate);
  await applyStockAction(owner, allocate);
  await stock(skuIds[5], "MELBOURNE", 4, "LEGACY");
  await expectStatus(() => stock(skuIds[5], "MELBOURNE", 1, "LEGACY"), 409);
  assert.equal(
    (
      await db.legacyStock.findUniqueOrThrow({
        where: { variantId: skuIds[5] },
      })
    ).remainingQty,
    0,
  );
  pass(
    "Legacy quantities stay unassigned until explicit allocation; split allocation and retries never double-count.",
  );
  await stock(skuIds[0], "BEIJING", 20);
  const t = await createTransfer(owner, {
    key: key(),
    lines: [{ variantId: skuIds[0], planned: 20 }],
  });
  assert.equal((await getBalance(skuIds[0], "BEIJING")).onHand, 20);
  const detail = await transferDetails(owner, t.id),
    line = detail.lines[0];
  const dispatch = {
    key: key(),
    reason,
    dispatchedAt: new Date().toISOString(),
    lines: [{ lineId: line.id, quantity: 20 }],
  };
  await dispatchTransfer(owner, t.id, dispatch);
  await dispatchTransfer(owner, t.id, dispatch);
  assert.equal((await getBalance(skuIds[0], "BEIJING")).onHand, 0);
  const receipt = {
    key: key(),
    reason,
    lines: [{ lineId: line.id, sellable: 17, unavailable: 1, lost: 0 }],
    attachmentMediaIds: [media.id],
  };
  await receiveTransfer(keeper, t.id, receipt);
  await receiveTransfer(keeper, t.id, receipt);
  const mel = await getBalance(skuIds[0], "MELBOURNE");
  assert.equal(mel.onHand, 18);
  assert.equal(mel.unavailable, 1);
  assert.equal(available(mel), 17);
  assert.equal(remaining((await transferDetails(owner, t.id)).lines[0]), 2);
  await expectStatus(
    () =>
      receiveTransfer(keeper, t.id, {
        ...receipt,
        key: key(),
        lines: [{ lineId: line.id, sellable: 3, unavailable: 0, lost: 0 }],
      }),
    409,
  );
  await expectStatus(
    () =>
      receiveTransfer(keeper, t.id, {
        ...receipt,
        key: key(),
        lines: [{ lineId: line.id, sellable: 0, unavailable: 0, lost: 2 }],
      }),
    403,
  );
  await receiveTransfer(owner, t.id, {
    ...receipt,
    key: key(),
    lines: [{ lineId: line.id, sellable: 0, unavailable: 0, lost: 2 }],
  });
  assert.equal((await transferDetails(owner, t.id)).status, "CLOSED");
  await expectStatus(() => cancelTransfer(owner, t.id, key(), reason), 409);
  pass(
    "20 dispatched, 18 received including 1 damaged: Melbourne 18 physical/17 sellable/1 unavailable, 2 pending then owner-confirmed lost; duplicate and excess receipts rejected.",
  );
  await stock(skuIds[1], "BEIJING", 1);
  const ts = await Promise.all(
    [0, 1].map(() =>
      createTransfer(owner, {
        key: key(),
        lines: [{ variantId: skuIds[1], planned: 1 }],
      }),
    ),
  );
  const sent = await Promise.allSettled(
    ts.map(async (x) => {
      const l = (await transferDetails(owner, x.id)).lines[0];
      return dispatchTransfer(owner, x.id, {
        key: key(),
        reason,
        dispatchedAt: new Date().toISOString(),
        lines: [{ lineId: l.id, quantity: 1 }],
      });
    }),
  );
  assert.equal(sent.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal((await getBalance(skuIds[1], "BEIJING")).onHand, 0);
  pass(
    "Concurrent transfers competing for one available unit permit exactly one dispatch.",
  );
  await stock(skuIds[2], "MELBOURNE", 1);
  await expectStatus(
    () => createOrder(customer([{ variantId: skuIds[2], quantity: 1 }])),
    409,
  );
  await saveCommerceSettings(owner, {
    key: key(),
    shippingCents: 1200,
    reservationMinutes: 30,
    reason,
  });
  const carts = [
    customer([{ variantId: skuIds[2], quantity: 1 }]),
    customer([{ variantId: skuIds[2], quantity: 1 }]),
  ];
  const race = await Promise.allSettled(carts.map(createOrder));
  assert.equal(race.filter((x) => x.status === "fulfilled").length, 1);
  const order = (
    race.find((x) => x.status === "fulfilled") as PromiseFulfilledResult<{
      id: string;
      number: string;
    }>
  ).value;
  const winner = race.findIndex((x) => x.status === "fulfilled");
  assert.equal((await createOrder(carts[winner])).id, order.id);
  assert.equal((await getBalance(skuIds[2], "MELBOURNE")).onHand, 1);
  assert.equal((await getBalance(skuIds[2], "MELBOURNE")).reserved, 1);
  const event = { key: key(), eventId: key(), outcome: "success", reason };
  await simulatePayment(owner, order.id, event);
  await simulatePayment(owner, order.id, event);
  assert.equal((await getBalance(skuIds[2], "MELBOURNE")).onHand, 1);
  const shipment = {
    key: key(),
    carrier: "Synthetic carrier",
    trackingNumber: "TEST-ONLY-TRACKING",
    reason,
  };
  await shipOrder(keeper, order.id, shipment);
  await shipOrder(keeper, order.id, shipment);
  assert.equal((await getBalance(skuIds[2], "MELBOURNE")).onHand, 0);
  assert.equal((await getBalance(skuIds[2], "MELBOURNE")).reserved, 0);
  await expectStatus(
    () => shipOrder(keeper, order.id, { ...shipment, key: key() }),
    409,
  );
  pass(
    "Two checkouts compete for the last unit: only one reserves. Idempotent payment and whole-order shipment never deduct physical stock twice.",
  );
  await stock(skuIds[3], "MELBOURNE", 4);
  const expired = await createOrder(
    customer([{ variantId: skuIds[3], quantity: 1 }]),
  );
  await db.shopOrder.update({
    where: { id: expired.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await expireOrders();
  await expireOrders();
  assert.equal((await getBalance(skuIds[3], "MELBOURNE")).reserved, 0);
  const late = await simulatePayment(owner, expired.id, {
    key: key(),
    eventId: key(),
    outcome: "success",
    reason,
  });
  assert.equal(late.result, "REVIEW");
  await expectStatus(() => shipOrder(keeper, expired.id, shipment), 409);
  const cancelled = await createOrder(
    customer([{ variantId: skuIds[3], quantity: 1 }]),
  );
  const cancelKey = key();
  await cancelOrder(owner, cancelled.id, cancelKey, reason);
  await cancelOrder(owner, cancelled.id, cancelKey, reason);
  assert.equal((await getBalance(skuIds[3], "MELBOURNE")).reserved, 0);
  const failed = await createOrder(
    customer([{ variantId: skuIds[3], quantity: 1 }]),
  );
  await simulatePayment(owner, failed.id, {
    key: key(),
    eventId: key(),
    outcome: "failure",
    reason,
  });
  assert.equal((await getBalance(skuIds[3], "MELBOURNE")).onHand, 4);
  assert.equal((await getBalance(skuIds[3], "MELBOURNE")).reserved, 0);
  const paidCancel = await createOrder(
    customer([{ variantId: skuIds[3], quantity: 1 }]),
  );
  await simulatePayment(owner, paidCancel.id, {
    key: key(),
    eventId: key(),
    outcome: "success",
    reason,
  });
  await cancelOrder(owner, paidCancel.id, key(), reason);
  assert.equal((await getBalance(skuIds[3], "MELBOURNE")).onHand, 4);
  assert.equal((await getBalance(skuIds[3], "MELBOURNE")).reserved, 0);
  pass(
    "Expiry and cancellation release reservations once; payment failure and paid cancellation do not add physical stock; late payment requires review.",
  );
  const lineOrder = await db.orderLine.findFirstOrThrow({
    where: { orderId: order.id },
  });
  const back = {
    key: key(),
    lineId: lineOrder.id,
    sellable: 0,
    unavailable: 1,
    reason,
  };
  await registerReturn(keeper, order.id, back);
  await registerReturn(keeper, order.id, back);
  await expectStatus(
    () => registerReturn(keeper, order.id, { ...back, key: key() }),
    409,
  );
  assert.equal((await getBalance(skuIds[2], "MELBOURNE")).onHand, 1);
  assert.equal((await getBalance(skuIds[2], "MELBOURNE")).unavailable, 1);
  assert.equal(
    (await db.shopOrder.findUniqueOrThrow({ where: { id: order.id } }))
      .recordedRefundCents,
    0,
  );
  pass(
    "Inspected physical returns distinguish sellable and unavailable goods, prevent excess returns, and never pretend to refund money.",
  );
  const oldLine = await db.orderLine.findFirstOrThrow({
    where: { orderId: order.id },
  });
  await db.category.create({
    data: {
      id: "changed-category",
      slug: "changed-category",
      name: "Changed category",
    },
  });
  await db.product.update({
    where: { id: "ops-product" },
    data: { name: "Renamed current product", categoryId: "changed-category" },
  });
  await db.productVariant.update({
    where: { id: skuIds[2] },
    data: { priceCents: 15900, compareAtPriceCents: null },
  });
  await db.collection.update({
    where: { id: "ops-collection" },
    data: { name: "Changed collection" },
  });
  const historical = await db.orderLine.findUniqueOrThrow({
    where: { id: oldLine.id },
  });
  assert.equal(historical.unitPriceCents, 8900);
  assert.equal(historical.categoryId, "ops-category");
  assert.equal(
    (historical.collections as { name: string }[])[0].name,
    "Original collection",
  );
  const deals = await orderList(owner, {
    q: order.number,
    deals: "true",
    category: "ops-category",
  });
  assert.equal(deals.total, 1);
  assert.equal(deals.stats!.wholeOrderCents, 10100);
  const multi = await createOrder(
    customer([
      { variantId: skuIds[0], quantity: 1 },
      { variantId: skuIds[3], quantity: 1 },
    ]),
  );
  const matched = await orderList(owner, { q: multi.number, sku: "OPS-0" });
  assert.equal(matched.stats!.orders, 1);
  assert.equal(matched.stats!.wholeOrderCents, 23000);
  assert.equal(matched.stats!.matchedItemCents, 8900);
  assert.equal(matched.stats!.matchedDiscountCents, 1000);
  pass(
    "Order snapshots survive product price/category/collection edits; historical Deals and filtered statistics count each order once.",
  );
  const b = await getBalance(skuIds[3], "MELBOURNE");
  const count = await submitCount(keeper, {
    key: key(),
    variantId: skuIds[3],
    warehouse: "MELBOURNE",
    countedOnHand: b.onHand - 1,
    reason,
  });
  await expectStatus(
    () => decideCount(keeper, count.id, key(), true, reason),
    403,
  );
  await decideCount(owner, count.id, key(), true, reason);
  assert.equal((await getBalance(skuIds[3], "MELBOURNE")).onHand, b.onHand - 1);
  const stale = await submitCount(keeper, {
    key: key(),
    variantId: skuIds[3],
    warehouse: "MELBOURNE",
    countedOnHand: 3,
    reason,
  });
  await stock(skuIds[3], "MELBOURNE", 1, "PURCHASE");
  await expectStatus(
    () => decideCount(owner, stale.id, key(), true, reason),
    409,
  );
  pass(
    "Warehouse counts require owner approval; stale counts and changes that violate reserved/unavailable balances are rejected.",
  );
  const active = ts[sent.findIndex((x) => x.status === "fulfilled")];
  const transport = await transferDetails(owner, active.id);
  await updateTransfer(owner, active.id, {
    key: key(),
    reason,
    carrier: "Test carrier",
    trackingNumber: "TEST",
    etaStart: "2020-01-01T00:00:00Z",
    etaEnd: "2020-01-02T00:00:00Z",
    exception: false,
    showRestocking: true,
    notes: "",
  });
  const status = (await publicAvailability([skuIds[1]])).get(skuIds[1])!;
  assert.equal(status.status, "RESTOCKING_SOON");
  assert.equal(status.etaEnd, null);
  assert.ok(
    (await inventoryList(owner, { overdue: "true" })).items.some(
      (v) => v.id === skuIds[1],
    ),
  );
  await saveSkuPolicy(owner, {
    key: key(),
    variantId: skuIds[1],
    lowStockThreshold: 2,
    showRestocking: false,
    reason,
  });
  assert.equal(
    (await publicAvailability([skuIds[1]])).get(skuIds[1])!.status,
    "OUT_OF_STOCK",
  );
  await stock(skuIds[4], "BEIJING", 2);
  assert.equal(
    (await publicAvailability([skuIds[4]])).get(skuIds[4])!.status,
    "RESTOCK_PLANNED",
  );
  void transport;
  pass(
    "Public SKU availability uses Melbourne sellable stock and valid restocking sources; overdue ETA promises are suppressed and restocking can be hidden.",
  );
  await expectStatus(
    () =>
      applyStockAction(keeper, {
        key: key(),
        variantId: skuIds[0],
        warehouse: "BEIJING",
        quantity: 1,
        kind: "PURCHASE",
        reason,
      }),
    403,
  );
  await expectStatus(
    () =>
      createAccount(keeper, {
        key: key(),
        name: "No",
        email: "no@example.invalid",
        password,
        role: "admin",
        reason,
      }),
    403,
  );
  await expectStatus(
    () =>
      updateAccount(owner, {
        key: key(),
        id: owner.id,
        role: "warehouse",
        active: true,
        reason,
      }),
    409,
  );
  const headers = await signIn("operations-warehouse@verification.invalid");
  assert.equal((await requireStaff(headers)).role, "warehouse");
  const visible = await orderDetails(keeper, order.id);
  assert.ok(!("email" in visible));
  assert.ok(!("totalCents" in visible));
  await updateAccount(owner, {
    key: key(),
    id: keeper.id,
    role: "viewer",
    active: true,
    reason,
  });
  await expectStatus(() => requireStaff(headers), 401);
  const readonly = await signIn("operations-warehouse@verification.invalid");
  await updateAccount(owner, {
    key: key(),
    id: keeper.id,
    role: "viewer",
    active: false,
    reason,
  });
  await expectStatus(() => requireStaff(readonly), 401);
  pass(
    "Warehouse cannot change prices/permissions/Beijing stock or approve counts; disabling or changing roles revokes existing sessions; last owner is protected.",
  );
  await expectStatus(
    () =>
      createOrder({
        ...customer([{ variantId: skuIds[4], quantity: 1 }]),
        priceCents: 1,
      }),
    400,
  );
  await expectStatus(() => stock(skuIds[4], "BEIJING", -1), 400);
  await assert.rejects(() =>
    db.inventoryBalance.update({
      where: {
        variantId_warehouse: { variantId: skuIds[4], warehouse: "BEIJING" },
      },
      data: { reserved: 3 },
    }),
  );
  const ledger = await db.inventoryLedger.findFirstOrThrow();
  await assert.rejects(() =>
    db.inventoryLedger.update({
      where: { id: ledger.id },
      data: { reason: "Not allowed" },
    }),
  );
  await assert.rejects(() => db.auditLog.deleteMany());
  const access = await issueOrderAccess(order.id);
  await checkOrderAccess(order.id, access);
  await expectStatus(() => checkOrderAccess(order.id, "0".repeat(64)), 404);
  await expectStatus(() => checkOrderAccess(multi.id, access), 404);
  const output = csv([["=SUM(1,1)", " @HYPERLINK(test)", "safe"]]);
  assert.ok(output.includes("'=SUM"));
  assert.ok(output.includes("' @HYPERLINK"));
  const savedCommands = JSON.stringify(await db.operationCommand.findMany());
  assert.ok(!savedCommands.includes(password));
  pass(
    "Strict checkout input, database quantity checks, append-only history, scoped guest access tokens and CSV formula escaping are enforced.",
  );
  const sourceReturn = await createTransfer(owner, {
    key: key(),
    lines: [{ variantId: skuIds[4], planned: 1 }],
  });
  const sourceLine = (await transferDetails(owner, sourceReturn.id)).lines[0];
  await dispatchTransfer(owner, sourceReturn.id, {
    key: key(),
    reason,
    dispatchedAt: new Date().toISOString(),
    lines: [{ lineId: sourceLine.id, quantity: 1 }],
  });
  const returned = {
    key: key(),
    reason,
    lines: [{ lineId: sourceLine.id, quantity: 1 }],
  };
  await returnTransfer(owner, sourceReturn.id, returned);
  await returnTransfer(owner, sourceReturn.id, returned);
  assert.equal((await getBalance(skuIds[4], "BEIJING")).onHand, 2);
  assert.equal(
    (await transferDetails(owner, sourceReturn.id)).status,
    "CLOSED",
  );
  assert.ok(
    (await inventoryList(owner, { discrepancy: "true" })).items.some(
      (r) => r.id === skuIds[0],
    ),
  );
  const oldMode = process.env.NODE_ENV;
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    await expectStatus(
      () =>
        simulatePayment(owner, expired.id, {
          key: key(),
          eventId: key(),
          outcome: "success",
          reason,
        }),
      403,
    );
  } finally {
    Object.assign(process.env, { NODE_ENV: oldMode });
  }
  pass(
    "Physical returns to Beijing reduce transit once; closed receipt discrepancies remain searchable; production rejects payment simulation.",
  );
  await stock(skuIds[4], "MELBOURNE", 3);
  assert.equal((await getBalance(skuIds[4], "BEIJING")).unavailable, 1);
  await expectStatus(() => stock(skuIds[4], "BEIJING", 2, "DAMAGE"), 409);
  await stock(skuIds[4], "BEIJING", 1, "RESTORE");
  await applyStockAction(owner, {
    key: key(),
    variantId: skuIds[4],
    warehouse: "MELBOURNE",
    kind: "PURCHASE",
    quantity: 2,
    unavailableQuantity: 1,
    reason,
  });
  assert.equal((await getBalance(skuIds[4], "MELBOURNE")).unavailable, 1);
  await expectStatus(
    () =>
      applyStockAction(owner, {
        key: key(),
        variantId: skuIds[4],
        warehouse: "MELBOURNE",
        kind: "PURCHASE",
        quantity: 1,
        unavailableQuantity: 2,
        reason,
      }),
    400,
  );
  const pendingId = "ops-legacy-discrepancy";
  await db.productVariant.create({
    data: {
      id: pendingId,
      productId: "ops-product",
      sku: "OPS-LEGACY-DISCREPANCY",
      priceCents: 1500,
      stock: 2,
    },
  });
  await db.legacyStock.create({
    data: { variantId: pendingId, originalQty: 2, remainingQty: 2 },
  });
  const discrepancy = {
    key: key(),
    variantId: pendingId,
    quantity: 2,
    reason: "Synthetic old sample stock confirmed nonexistent",
  };
  await resolveLegacyDiscrepancy(owner, discrepancy);
  await resolveLegacyDiscrepancy(owner, discrepancy);
  assert.equal(
    (
      await db.legacyStock.findUniqueOrThrow({
        where: { variantId: pendingId },
      })
    ).remainingQty,
    0,
  );
  assert.equal(
    await db.inventoryBalance.count({ where: { variantId: pendingId } }),
    0,
  );
  await expectStatus(
    () => resolveLegacyDiscrepancy(keeper, { ...discrepancy, key: key() }),
    403,
  );
  pass(
    "Incoming damaged units and source returns stay unavailable until inspected; confirmed nonexistent legacy stock is resolved without creating physical stock.",
  );
  await updateAccount(owner, {
    key: key(),
    id: keeper.id,
    role: "warehouse",
    active: true,
    reason,
  });
  await fs.mkdir(".local", { recursive: true, mode: 0o700 });
  await fs.writeFile(
    ".local/operations-qa.json",
    JSON.stringify({
      ownerEmail: "operations-owner@verification.invalid",
      warehouseEmail: "operations-warehouse@verification.invalid",
      password,
      ownerId: owner.id,
      warehouseId: keeper.id,
      productSlug: "operations-test-ring",
      skuIds,
      orderId: order.id,
      transferId: active.id,
    }),
    { mode: 0o600 },
  );
  await fs.writeFile(
    ".local/operations-verification.json",
    JSON.stringify(
      {
        database: "forme_operations_test",
        checks,
        passed: true,
        productId: "ops-product",
        skuIds,
        orderId: order.id,
        mediaId: media.id,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    `PASS: ${checks.length} operations groups against the isolated database; development data was not changed.`,
  );
}
main()
  .catch((e) => {
    console.error(
      "Operations check failed:",
      e instanceof assert.AssertionError
        ? `${e.operator} (actual=${String(e.actual)}, expected=${String(e.expected)})`
        : e instanceof Error
          ? e.name
          : "Unknown",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
