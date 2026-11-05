import "server-only";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { database } from "../db";
import { HttpError } from "../errors";
import { checkoutSchema, ident, key, reason, quantity } from "./validation";
import {
  command,
  lock,
  owner,
  staff,
  audit,
  type Actor,
  type Tx,
} from "./core";
import { balance, available, changeBalance } from "./inventory";
import { commerceSettings } from "./settings";
import { withActorNames } from "./annotations";
const publicActor: Actor = { id: "guest", role: "guest" };
const system: Actor = { id: "expiry-worker", role: "system" };
const itemsSchema = z
  .array(
    z.object({ variantId: ident, quantity: quantity.min(1).max(99) }).strict(),
  )
  .min(1)
  .max(30);
export async function quote(input: unknown) {
  const { items } = z.object({ items: itemsSchema }).strict().parse(input);
  if (new Set(items.map((i) => i.variantId)).size !== items.length)
    throw new HttpError(400, "Combine duplicate SKU lines.");
  const settings = await commerceSettings();
  const skus = await database().productVariant.findMany({
    where: {
      id: { in: items.map((i) => i.variantId) },
      enabled: true,
      product: { status: "PUBLISHED", category: { active: true } },
    },
    include: { product: { select: { name: true } } },
  });
  const balances = await database().inventoryBalance.findMany({
    where: {
      warehouse: "MELBOURNE",
      variantId: { in: items.map((i) => i.variantId) },
    },
  });
  const lines = items.map((item) => {
    const v = skus.find((v) => v.id === item.variantId);
    if (!v) throw new HttpError(409, "A selected SKU is no longer available.");
    const b = balances.find((b) => b.variantId === v.id),
      stock = b ? available(b) : 0;
    return {
      variantId: v.id,
      name: v.product.name,
      sku: v.sku,
      option: [v.size, v.color].filter(Boolean).join(" / ") || "Default",
      quantity: item.quantity,
      unitPriceCents: v.priceCents,
      totalCents: v.priceCents * item.quantity,
      available: stock,
      sufficient: stock >= item.quantity,
    };
  });
  const subtotalCents = lines.reduce((n, l) => n + l.totalCents, 0);
  return {
    lines,
    subtotalCents,
    shippingCents: settings.shippingCents,
    totalCents:
      settings.shippingCents === null
        ? null
        : subtotalCents + settings.shippingCents,
    canCheckout:
      settings.shippingCents !== null && lines.every((l) => l.sufficient),
    reservationMinutes: settings.reservationMinutes,
  };
}
export async function createOrder(input: unknown) {
  const v = checkoutSchema.parse(input);
  return command(publicActor, "guest-checkout", v.key, v, async (tx) => {
    const settings = await tx.commerceSettings.findUnique({
      where: { id: "commerce" },
    });
    if (!settings || settings.shippingCents === null)
      throw new HttpError(
        409,
        "Shipping is not configured. Checkout is currently unavailable.",
      );
    const selected = [];
    for (const item of [...v.items].sort((a, b) =>
      a.variantId.localeCompare(b.variantId),
    )) {
      // Serialize inventory before reading current published SKU prices and quantities.
      const b = await balance(tx, item.variantId, "MELBOURNE");
      const sku = await tx.productVariant.findFirst({
        where: {
          id: item.variantId,
          enabled: true,
          product: { status: "PUBLISHED", category: { active: true } },
        },
        include: {
          product: {
            include: {
              category: true,
              collections: { include: { collection: true } },
              images: { orderBy: { sortOrder: "asc" } },
            },
          },
        },
      });
      if (!sku || available(b) < item.quantity)
        throw new HttpError(
          409,
          "A selected SKU does not have enough Melbourne stock. Refresh your bag.",
        );
      selected.push({ item, sku });
    }
    const subtotalCents = selected.reduce(
      (n, { item, sku }) => n + item.quantity * sku.priceCents,
      0,
    );
    const discountCents = selected.reduce(
      (n, { item, sku }) =>
        n +
        item.quantity *
          Math.max(
            0,
            (sku.compareAtPriceCents ?? sku.priceCents) - sku.priceCents,
          ),
      0,
    );
    if (
      !Number.isSafeInteger(subtotalCents) ||
      subtotalCents > 1_000_000_000 ||
      discountCents > 1_000_000_000
    )
      throw new HttpError(400, "Order total or discount is too large.");
    const order = await tx.shopOrder.create({
      data: {
        number: `FO-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 10).replaceAll("-", "").toUpperCase()}`,
        email: v.email.toLowerCase(),
        recipientName: v.recipientName,
        addressLine1: v.addressLine1,
        addressLine2: v.addressLine2,
        city: v.city,
        state: v.state,
        postcode: v.postcode,
        subtotalCents,
        discountCents,
        shippingCents: settings.shippingCents,
        totalCents: subtotalCents + settings.shippingCents,
        expiresAt: new Date(Date.now() + settings.reservationMinutes * 60000),
        lines: {
          create: selected.map(({ item, sku }) => {
            const originalUnitCents = sku.compareAtPriceCents ?? sku.priceCents;
            return {
              variantId: sku.id,
              productId: sku.product.id,
              productName: sku.product.name,
              sku: sku.sku,
              size: sku.size,
              color: sku.color,
              categoryId: sku.product.categoryId,
              categoryName: sku.product.category.name,
              collections: sku.product.collections.map((c) => ({
                id: c.collectionId,
                name: c.collection.name,
              })),
              imageMediaId: sku.product.images.find(
                (i) => !i.variantId || i.variantId === sku.id,
              )?.mediaId,
              quantity: item.quantity,
              originalUnitCents,
              unitPriceCents: sku.priceCents,
              discountSource:
                originalUnitCents > sku.priceCents ? "MARKDOWN" : "NONE",
              discountCents:
                (originalUnitCents - sku.priceCents) * item.quantity,
              lineTotalCents: sku.priceCents * item.quantity,
            };
          }),
        },
      },
    });
    for (const { item, sku } of selected) {
      await tx.stockReservation.create({
        data: { orderId: order.id, variantId: sku.id, quantity: item.quantity },
      });
      await changeBalance(
        tx,
        publicActor,
        sku.id,
        "MELBOURNE",
        { reserved: item.quantity },
        "ORDER_RESERVED",
        "order",
        order.id,
        "Guest checkout inventory reservation",
      );
    }
    await audit(
      tx,
      publicActor,
      "ORDER_CREATED",
      "order",
      order.id,
      "Awaiting payment; no real payment is connected",
      undefined,
      { totalCents: order.totalCents, expiresAt: order.expiresAt },
    );
    return { id: order.id, number: order.number };
  });
}
async function lockedOrder(tx: Tx, id: string) {
  await lock(tx, `order:${id}`);
  const o = await tx.shopOrder.findUnique({
    where: { id },
    include: { reservations: { orderBy: { variantId: "asc" } }, lines: true },
  });
  if (!o) throw new HttpError(404, "Order not found.");
  return o;
}
type LockedOrder = Awaited<ReturnType<typeof lockedOrder>>;
async function release(tx: Tx, actor: Actor, o: LockedOrder, reason: string) {
  for (const r of o.reservations.filter((r) => r.status === "ACTIVE")) {
    await changeBalance(
      tx,
      actor,
      r.variantId,
      "MELBOURNE",
      { reserved: -r.quantity },
      "ORDER_RELEASED",
      "order",
      o.id,
      reason,
    );
    await tx.stockReservation.update({
      where: { id: r.id },
      data: { status: "RELEASED", resolvedAt: new Date() },
    });
  }
}
export async function expireOrders(now = new Date()) {
  const pending = await database().shopOrder.findMany({
    where: {
      paymentStatus: "PENDING",
      fulfillmentStatus: "UNFULFILLED",
      expiresAt: { lte: now },
    },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: 200,
  });
  let released = 0;
  for (const p of pending)
    await database().$transaction(
      async (tx) => {
        const o = await lockedOrder(tx, p.id);
        if (
          o.paymentStatus !== "PENDING" ||
          o.fulfillmentStatus !== "UNFULFILLED" ||
          o.expiresAt > now
        )
          return;
        await release(tx, system, o, "Reservation expired");
        await tx.shopOrder.update({
          where: { id: o.id },
          data: { paymentStatus: "EXPIRED" },
        });
        await audit(
          tx,
          system,
          "ORDER_EXPIRED",
          "order",
          o.id,
          "Reservation expired",
        );
        released++;
      },
      { timeout: 15000 },
    );
  return { released };
}
export async function cancelOrder(
  actor: Actor,
  id: string,
  requestKey: string,
  reason: string,
) {
  if (!["admin", "guest"].includes(actor.role))
    throw new HttpError(403, "Cancellation is not authorized.");
  return command(
    actor,
    "order-cancel",
    requestKey,
    { id, reason },
    async (tx) => {
      const o = await lockedOrder(tx, id);
      if (o.fulfillmentStatus === "SHIPPED")
        throw new HttpError(
          409,
          "Shipped orders require a physical return; cancellation cannot restore stock.",
        );
      if (actor.role === "guest" && o.paymentStatus !== "PENDING")
        throw new HttpError(
          409,
          "Contact the owner to cancel an order that is no longer pending.",
        );
      if (o.fulfillmentStatus === "CANCELLED") return { id };
      await release(tx, actor, o, reason);
      await tx.shopOrder.update({
        where: { id },
        data: {
          fulfillmentStatus: "CANCELLED",
          cancelledAt: new Date(),
          ...(o.paymentStatus === "PAID"
            ? {
                exception:
                  "Paid order cancelled; no refund has been processed.",
              }
            : {}),
        },
      });
      await audit(tx, actor, "ORDER_CANCELLED", "order", id, reason);
      return { id };
    },
  );
}
export async function simulatePayment(
  actor: Actor,
  id: string,
  input: unknown,
) {
  owner(actor);
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_DEV_PAYMENTS !== "true"
  )
    throw new HttpError(403, "Development payment simulation is disabled.");
  const v = z
    .object({
      key,
      eventId: key,
      outcome: z.enum(["success", "failure"]),
      reason,
    })
    .strict()
    .parse(input);
  return command(
    actor,
    "dev-payment-event",
    v.eventId,
    { id, outcome: v.outcome },
    async (tx) => {
      const o = await lockedOrder(tx, id);
      if (
        o.paymentStatus !== "PENDING" ||
        o.fulfillmentStatus !== "UNFULFILLED"
      ) {
        if (
          v.outcome === "success" &&
          ["EXPIRED", "FAILED"].includes(o.paymentStatus) &&
          o.fulfillmentStatus !== "SHIPPED"
        ) {
          await tx.shopOrder.update({
            where: { id },
            data: {
              paymentStatus: "REVIEW",
              exception:
                "Payment reported after inventory release. No stock is reserved; manual review required.",
            },
          });
          await tx.paymentEvent.create({
            data: {
              orderId: id,
              eventId: v.eventId,
              outcome: v.outcome,
              result: "REVIEW",
            },
          });
          await audit(tx, actor, "LATE_PAYMENT_REVIEW", "order", id, v.reason);
          return { id, result: "REVIEW" };
        }
        throw new HttpError(409, "The order cannot accept this payment event.");
      }
      const expired = o.expiresAt.getTime() <= Date.now();
      let result = "PAID";
      if (expired || v.outcome === "failure") {
        await release(
          tx,
          actor,
          o,
          expired
            ? "Payment arrived after reservation expiry"
            : "Simulated payment failed",
        );
        result =
          expired && v.outcome === "success"
            ? "REVIEW"
            : v.outcome === "failure"
              ? "FAILED"
              : "EXPIRED";
        await tx.shopOrder.update({
          where: { id },
          data: {
            paymentStatus: result as "REVIEW" | "FAILED" | "EXPIRED",
            exception:
              result === "REVIEW"
                ? "Late payment reported; inventory was released. Manual review required."
                : "",
          },
        });
      } else {
        if (
          o.reservations.some((r) => r.status !== "ACTIVE") ||
          o.reservations.length !== o.lines.length
        )
          throw new HttpError(
            409,
            "The order no longer holds all required inventory.",
          );
        await tx.shopOrder.update({
          where: { id },
          data: { paymentStatus: "PAID", paidAt: new Date() },
        });
      }
      await tx.paymentEvent.create({
        data: { orderId: id, eventId: v.eventId, outcome: v.outcome, result },
      });
      await audit(
        tx,
        actor,
        "DEV_PAYMENT_EVENT",
        "order",
        id,
        v.reason,
        undefined,
        { outcome: v.outcome, result, eventId: v.eventId },
      );
      return { id, result };
    },
  );
}
export async function shipOrder(actor: Actor, id: string, input: unknown) {
  staff(actor, true);
  const v = z
    .object({
      key,
      carrier: z.string().trim().min(1).max(120),
      trackingNumber: z.string().trim().min(1).max(200),
      reason,
    })
    .strict()
    .parse(input);
  return command(actor, "order-ship", v.key, { id, ...v }, async (tx) => {
    const o = await lockedOrder(tx, id);
    if (
      o.paymentStatus !== "PAID" ||
      o.fulfillmentStatus !== "UNFULFILLED" ||
      o.reservations.some((r) => r.status !== "ACTIVE")
    )
      throw new HttpError(
        409,
        "Only a fully reserved, paid, unshipped order can ship. Whole-order shipping only.",
      );
    for (const r of o.reservations) {
      await changeBalance(
        tx,
        actor,
        r.variantId,
        "MELBOURNE",
        { onHand: -r.quantity, reserved: -r.quantity },
        "ORDER_SHIPPED",
        "order",
        id,
        v.reason,
      );
      await tx.stockReservation.update({
        where: { id: r.id },
        data: { status: "CONSUMED", resolvedAt: new Date() },
      });
    }
    await tx.shopOrder.update({
      where: { id },
      data: {
        fulfillmentStatus: "SHIPPED",
        shippedAt: new Date(),
        carrier: v.carrier,
        trackingNumber: v.trackingNumber,
      },
    });
    await audit(tx, actor, "ORDER_SHIPPED", "order", id, v.reason, undefined, {
      carrier: v.carrier,
      trackingNumber: v.trackingNumber,
    });
    return { id };
  });
}
export async function registerReturn(actor: Actor, id: string, input: unknown) {
  staff(actor, true);
  const v = z
    .object({
      key,
      lineId: ident,
      sellable: quantity,
      unavailable: quantity,
      reason,
    })
    .strict()
    .refine(
      (v) => v.sellable + v.unavailable > 0,
      "Enter the actual inspected return quantity.",
    )
    .parse(input);
  return command(actor, "order-return", v.key, { id, ...v }, async (tx) => {
    const o = await lockedOrder(tx, id);
    if (o.fulfillmentStatus !== "SHIPPED")
      throw new HttpError(409, "Only shipped goods can be returned.");
    const line = o.lines.find((l) => l.id === v.lineId);
    if (!line) throw new HttpError(404, "Order line not found.");
    const returns = await tx.orderReturn.aggregate({
      where: { lineId: line.id },
      _sum: { sellable: true, unavailable: true },
    });
    if (
      (returns._sum.sellable ?? 0) +
        (returns._sum.unavailable ?? 0) +
        v.sellable +
        v.unavailable >
      line.quantity
    )
      throw new HttpError(409, "Return exceeds the shipped quantity.");
    const r = await tx.orderReturn.create({
      data: {
        orderId: id,
        lineId: line.id,
        sellable: v.sellable,
        unavailable: v.unavailable,
        reason: v.reason,
        actorId: actor.id,
      },
    });
    await changeBalance(
      tx,
      actor,
      line.variantId,
      "MELBOURNE",
      { onHand: v.sellable + v.unavailable, unavailable: v.unavailable },
      "PHYSICAL_RETURN",
      "return",
      r.id,
      v.reason,
    );
    await audit(
      tx,
      actor,
      "PHYSICAL_RETURN",
      "order",
      id,
      v.reason,
      undefined,
      {
        lineId: line.id,
        sellable: v.sellable,
        unavailable: v.unavailable,
        refundProcessed: false,
      },
    );
    return { id, returnId: r.id };
  });
}
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export async function issueOrderAccess(orderId: string) {
  const token = randomBytes(32).toString("hex");
  await database().orderAccess.create({
    data: {
      orderId,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  return token;
}
export async function checkOrderAccess(orderId: string, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new HttpError(404, "Order access not found.");
  const a = await database().orderAccess.findFirst({
    where: { orderId, tokenHash: hash(token), expiresAt: { gt: new Date() } },
  });
  if (!a) throw new HttpError(404, "Order access not found.");
}
export async function orderDetails(actor: Actor, id: string) {
  if (actor.role !== "guest") staff(actor);
  if (actor.role === "viewer")
    throw new HttpError(
      403,
      "This read-only account is authorized for inventory and transfers only.",
    );
  const o = await database().shopOrder.findUnique({
    where: { id },
    include: { lines: true, returns: true },
  });
  if (
    !o ||
    (actor.role === "warehouse" &&
      (o.paymentStatus !== "PAID" || o.fulfillmentStatus === "CANCELLED"))
  )
    throw new HttpError(404, "Order not found.");
  const history = await database().auditLog.findMany({
    where: { objectType: "order", objectId: id },
    select: {
      id: true,
      action: true,
      reason: true,
      createdAt: true,
      actorId: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const base = {
    id: o.id,
    number: o.number,
    paymentStatus: o.paymentStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    createdAt: o.createdAt,
    expiresAt: o.expiresAt,
    paidAt: o.paidAt,
    shippedAt: o.shippedAt,
    cancelledAt: o.cancelledAt,
    carrier: o.carrier,
    trackingNumber: o.trackingNumber,
    exception: o.exception,
    history:
      actor.role === "guest"
        ? history.map((h) => ({
            id: h.id,
            action: h.action,
            createdAt: h.createdAt,
          }))
        : await withActorNames(history),
  };
  const address = {
    recipientName: o.recipientName,
    addressLine1: o.addressLine1,
    addressLine2: o.addressLine2,
    city: o.city,
    state: o.state,
    postcode: o.postcode,
    country: o.country,
  };
  if (actor.role === "warehouse")
    return {
      ...base,
      ...address,
      lines: o.lines.map((l) => ({
        id: l.id,
        variantId: l.variantId,
        productName: l.productName,
        sku: l.sku,
        size: l.size,
        color: l.color,
        quantity: l.quantity,
        imageMediaId: l.imageMediaId,
      })),
      returns: o.returns,
    };
  return {
    ...base,
    ...address,
    email: o.email,
    currency: o.currency,
    subtotalCents: o.subtotalCents,
    discountCents: o.discountCents,
    shippingCents: o.shippingCents,
    totalCents: o.totalCents,
    recordedRefundCents: o.recordedRefundCents,
    ...(actor.role === "admin"
      ? {
          devPaymentsEnabled:
            process.env.NODE_ENV !== "production" &&
            process.env.ENABLE_DEV_PAYMENTS === "true",
        }
      : {}),
    lines: o.lines,
    returns: o.returns,
  };
}
