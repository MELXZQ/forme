import "server-only";
import { z } from "zod";
import { database } from "../db";
import { Prisma } from "@/generated/prisma/client";
import { HttpError } from "../errors";
import { staff, csv, audit, command, type Actor } from "../operations/core";
import { allowed, base, day, zone, ident } from "../business/common";
import { accessOrder, caseAccess, compensationAccess, permit } from "./access";
import { dateBounds, localDay } from "../notifications/time";
import { canView, internalLink } from "../notifications/access";
export const filterSchema = z
  .object({
    q: z.string().max(200).optional(),
    email: z.string().max(200).optional(),
    name: z.string().max(120).optional(),
    tracking: z.string().max(200).optional(),
    reference: z.string().max(200).optional(),
    dateField: z
      .enum([
        "created",
        "paid",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ])
      .default("created"),
    from: day.optional(),
    to: day.optional(),
    timezone: zone.default("Australia/Melbourne"),
    product: ident.optional(),
    sku: z.string().max(120).optional(),
    size: z.string().max(80).optional(),
    color: z.string().max(80).optional(),
    category: ident.optional(),
    collection: ident.optional(),
    campaign: ident.optional(),
    deal: z.enum(["yes", "no", "unknown"]).optional(),
    payment: z
      .enum(["PENDING", "PAID", "FAILED", "EXPIRED", "REVIEW"])
      .optional(),
    fulfillment: z.enum(["UNFULFILLED", "SHIPPED", "CANCELLED"]).optional(),
    transport: z
      .enum(["NOT_SHIPPED", "IN_TRANSIT", "DELIVERED", "EXCEPTION"])
      .optional(),
    aftercare: z.string().max(40).optional(),
    compensation: z.string().max(40).optional(),
    refund: z.enum(["none", "partial", "full"]).optional(),
    exception: z
      .enum([
        "unverified",
        "inventory",
        "shipment",
        "delivery",
        "aftercare",
        "compensation",
      ])
      .optional(),
    state: z.string().max(10).optional(),
    postcode: z.string().max(10).optional(),
    carrier: z.string().max(120).optional(),
    shippingMethod: z.literal("STANDARD_AU").optional(),
    currency: z.literal("AUD").default("AUD"),
    dataKind: z.enum(["REAL", "TEST", "UNKNOWN", "ALL"]).default("ALL"),
    amountField: z
      .enum(["merchandise", "payable", "received", "discount", "refunded"])
      .default("payable"),
    min: z.coerce.number().int().nonnegative().max(1e9).optional(),
    max: z.coerce.number().int().nonnegative().max(1e9).optional(),
    sort: z
      .enum(["newest", "oldest", "amount_desc", "amount_asc"])
      .default("newest"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    format: z.literal("csv").optional(),
    pii: z.enum(["true", "false"]).optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, "Invalid date range")
  .refine(
    (v) => v.min === undefined || v.max === undefined || v.min <= v.max,
    "Invalid amount range",
  );
export const cleanQuery = (v: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(v).filter(([, x]) => x !== "" && x != null),
  );
export type Filter = z.infer<typeof filterSchema>;
export function lineWhere(q: Filter): Prisma.OrderLineWhereInput {
  const and: Prisma.OrderLineWhereInput[] = [];
  if (q.product) and.push({ productId: q.product });
  if (q.sku) and.push({ sku: { contains: q.sku, mode: "insensitive" } });
  if (q.size) and.push({ size: { equals: q.size, mode: "insensitive" } });
  if (q.color) and.push({ color: { equals: q.color, mode: "insensitive" } });
  if (q.category) and.push({ categoryId: q.category });
  if (q.collection)
    and.push({ collections: { array_contains: [{ id: q.collection }] } });
  if (q.campaign)
    and.push({ campaigns: { array_contains: [{ id: q.campaign }] } });
  if (q.deal === "yes") and.push({ discountSource: "MARKDOWN" });
  if (q.deal === "no") and.push({ discountSource: "NONE" });
  if (q.deal === "unknown")
    and.push({ pricingBasis: "LEGACY_REFERENCE_DIFFERENCE" });
  return { AND: and };
}
export function range(q: {
  from?: string;
  to?: string;
  timezone: "Australia/Melbourne" | "Asia/Shanghai";
}) {
  return {
    ...(q.from ? { gte: dateBounds(q.from, q.timezone).gte } : {}),
    ...(q.to ? { lt: dateBounds(q.to, q.timezone).lt } : {}),
  };
}
export async function orderWhere(
  actor: Actor,
  q: Filter,
): Promise<Prisma.ShopOrderWhereInput> {
  staff(actor);
  if (actor.role === "viewer") throw new HttpError(403, "Order access denied");
  if (
    !(await allowed(actor, "orderStats")) &&
    (q.reference ||
      q.amountField !== "payable" ||
      q.min !== undefined ||
      q.max !== undefined ||
      q.sort.startsWith("amount") ||
      q.refund)
  )
    throw new HttpError(
      403,
      "Financial and customer exports require owner scope",
    );
  if (q.email || q.pii === "true") await permit(actor, "customerExport");
  const and: Prisma.ShopOrderWhereInput[] = [{ currency: q.currency }];
  if (actor.role === "warehouse")
    and.push({
      paymentStatus: "PAID",
      fulfillmentStatus: { not: "CANCELLED" },
    });
  if (q.dataKind !== "ALL") and.push({ dataKind: q.dataKind });
  if (q.q) and.push({ number: { contains: q.q, mode: "insensitive" } });
  if (q.name)
    and.push({ recipientName: { contains: q.name, mode: "insensitive" } });
  if (q.email) and.push({ email: { contains: q.email, mode: "insensitive" } });
  if (q.tracking) {
    const parcels = await database().parcel.findMany({
      where: {
        trackingNumber: { contains: q.tracking, mode: "insensitive" },
        orderId: { not: null },
      },
      select: { orderId: true },
    });
    and.push({
      OR: [
        { trackingNumber: { contains: q.tracking, mode: "insensitive" } },
        { id: { in: parcels.map((p) => p.orderId!) } },
      ],
    });
  }
  if (q.reference)
    and.push({
      OR: [
        {
          payments: {
            some: { eventId: { contains: q.reference, mode: "insensitive" } },
          },
        },
        {
          events: {
            some: {
              type: "PAYMENT_SUCCEEDED",
              after: { path: ["reference"], string_contains: q.reference },
            },
          },
        },
      ],
    });
  if (q.from || q.to) {
    const r = range(q);
    if (q.dateField === "refunded")
      and.push({ refunds: { some: { occurredAt: r } } });
    else
      and.push({
        [{
          created: "createdAt",
          paid: "paidAt",
          shipped: "shippedAt",
          delivered: "deliveredAt",
          cancelled: "cancelledAt",
        }[q.dateField]]: r,
      });
  }
  if (q.payment) and.push({ paymentStatus: q.payment });
  if (q.fulfillment) and.push({ fulfillmentStatus: q.fulfillment });
  if (q.transport === "NOT_SHIPPED") and.push({ shippedAt: null });
  if (q.transport === "IN_TRANSIT")
    and.push({ shippedAt: { not: null }, deliveredAt: null });
  if (q.transport === "DELIVERED") and.push({ deliveredAt: { not: null } });
  if (q.transport === "EXCEPTION") and.push({ exception: { not: "" } });
  if (q.aftercare) and.push({ cases: { some: { status: q.aftercare } } });
  if (q.compensation)
    and.push({ compensations: { some: { status: q.compensation } } });
  if (q.refund === "none") and.push({ recordedRefundCents: 0 });
  if (q.refund === "partial")
    and.push({
      recordedRefundCents: {
        gt: 0,
        lt: database().shopOrder.fields.totalCents,
      },
    });
  if (q.refund === "full")
    and.push({
      recordedRefundCents: {
        gte: database().shopOrder.fields.totalCents,
        gt: 0,
      },
    });
  if (q.exception === "unverified")
    and.push({
      OR: [
        { paymentStatus: "REVIEW" },
        { dataKind: "UNKNOWN", paymentStatus: "PAID" },
      ],
    });
  else if (q.exception === "inventory")
    and.push({ exception: { contains: "stock", mode: "insensitive" } });
  else if (q.exception) {
    const kinds = {
      shipment: ["SHIPMENT"],
      delivery: ["DELIVERY"],
      aftercare: ["FIRST_RESPONSE", "CASE_RESOLUTION"],
      compensation: ["COMPENSATION"],
    }[q.exception];
    const t = await database().orderTimer.findMany({
      where: {
        active: true,
        kind: { in: kinds },
        deadlineAt: { lt: new Date() },
        pauses: {
          none: { startsAt: { lte: new Date() }, endsAt: { gt: new Date() } },
        },
      },
      select: { orderId: true },
    });
    and.push({ id: { in: t.map((t) => t.orderId) } });
  }
  for (const f of ["state", "postcode", "carrier", "shippingMethod"] as const)
    if (q[f]) and.push({ [f]: q[f] });
  const lw = lineWhere(q);
  if ((lw.AND as unknown[]).length) and.push({ lines: { some: lw } });
  if (q.min !== undefined || q.max !== undefined) {
    const col = {
      merchandise: "subtotalCents",
      payable: "totalCents",
      received: "totalCents",
      discount: "actualDiscountCents",
      refunded: "recordedRefundCents",
    }[q.amountField];
    and.push({ [col]: { gte: q.min, lte: q.max } });
    if (q.amountField === "received")
      and.push({
        events: {
          some: {
            type: "PAYMENT_SUCCEEDED",
            dataKind: { in: ["REAL", "TEST"] },
          },
        },
      });
  }
  return { AND: and };
}
export async function orders(actor: Actor, raw: Record<string, unknown>) {
  const q = filterSchema.parse(cleanQuery(raw));
  const where = await orderWhere(actor, q);
  const db = database();
  const total = await db.shopOrder.count({ where });
  const exporting = q.format === "csv";
  if (exporting) {
    await permit(actor, "orderExport");
    if (q.pii === "true") await permit(actor, "customerExport");
    if (total > 5000)
      throw new HttpError(400, "Narrow export to at most 5000 orders");
  }
  const sort = q.sort.startsWith("amount")
    ? {
        totalCents:
          q.sort === "amount_desc" ? ("desc" as const) : ("asc" as const),
      }
    : { createdAt: q.sort === "oldest" ? ("asc" as const) : ("desc" as const) };
  const financialView = await allowed(actor, "orderStats");
  const [rows, sums, matched] = await Promise.all([
    db.shopOrder.findMany({
      where,
      orderBy: [sort, { id: "asc" }],
      skip: exporting ? 0 : (q.page - 1) * q.pageSize,
      take: exporting ? 5000 : q.pageSize,
      include: { lines: { where: lineWhere(q) } },
    }),
    financialView
      ? db.shopOrder.aggregate({
          where,
          _sum: {
            subtotalCents: true,
            totalCents: true,
            actualDiscountCents: true,
            recordedRefundCents: true,
          },
        })
      : null,
    financialView
      ? db.orderLine.aggregate({
          where: { ...lineWhere(q), order: where },
          _sum: { quantity: true, lineTotalCents: true },
        })
      : null,
  ]);
  const items = rows.map((o) =>
    financialView
      ? {
          id: o.id,
          number: o.number,
          createdAt: o.createdAt,
          paidAt: o.paidAt,
          shippedAt: o.shippedAt,
          deliveredAt: o.deliveredAt,
          dataKind: o.dataKind,
          paymentStatus: o.paymentStatus,
          fulfillmentStatus: o.fulfillmentStatus,
          totalCents: o.totalCents,
          matchedCents: o.lines.reduce((n, l) => n + l.lineTotalCents, 0),
          actualDiscountCents: o.actualDiscountCents,
          refundCents: o.recordedRefundCents,
          state: o.state,
          ...(q.pii === "true"
            ? { email: o.email, recipientName: o.recipientName }
            : {}),
          trackingNumber: o.trackingNumber,
        }
      : {
          id: o.id,
          number: o.number,
          createdAt: o.createdAt,
          paymentStatus: o.paymentStatus,
          fulfillmentStatus: o.fulfillmentStatus,
          state: o.state,
          trackingNumber: o.trackingNumber,
          ...(q.pii === "true"
            ? { email: o.email, recipientName: o.recipientName }
            : {}),
        },
  );
  if (q.pii === "true") await permit(actor, "customerExport");
  if (exporting) {
    await db.$transaction((tx) =>
      audit(
        tx,
        actor,
        "ORDER_EXPORT",
        "export",
        "orders",
        "Authorized minimal export",
        undefined,
        { filters: q, count: total, pii: q.pii === "true" },
      ),
    );
    const fields = Object.keys(items[0] ?? { number: "", totalCents: 0 });
    return csv([
      [
        "Order export",
        q.dataKind,
        "date basis: " + q.dateField,
        q.timezone,
        "all amounts AUD cents",
      ],
      ["Filters", JSON.stringify(q)],
      fields,
      ...items.map((i) => fields.map((f) => (i as Record<string, unknown>)[f])),
    ]);
  }
  return {
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
    summary: sums
      ? {
          wholeOrders: {
            ...sums._sum,
            verifiedReceivedCents:
              (
                await db.orderEvent.aggregate({
                  where: {
                    type: "PAYMENT_SUCCEEDED",
                    dataKind: { in: ["REAL", "TEST"] },
                    order: where,
                  },
                  _sum: { amountCents: true },
                })
              )._sum.amountCents ?? 0,
          },
          matchedLines: matched?._sum,
          unknownDiscountOrders: await db.shopOrder.count({
            where: { AND: [where, { actualDiscountCents: null }] },
          }),
        }
      : null,
    filters: q,
  };
}
export async function saveFilter(actor: Actor, input: unknown) {
  staff(actor);
  if (actor.role === "viewer") throw new HttpError(403, "Orders unavailable");
  const v = z
    .object({
      ...base,
      name: z.string().trim().min(1).max(80),
      query: z.record(z.string(), z.unknown()),
      remove: z.boolean().default(false),
    })
    .strict()
    .parse(input);
  const q = filterSchema.parse(cleanQuery(v.query));
  await orderWhere(actor, q);
  return command(actor, "order-filter", v.key, v, async (tx) => {
    if (v.remove) {
      await tx.savedOrderFilter.deleteMany({
        where: { userId: actor.id, name: v.name },
      });
      return { deleted: true };
    }
    const count = await tx.savedOrderFilter.count({
      where: { userId: actor.id },
    });
    if (
      count >= 30 &&
      !(await tx.savedOrderFilter.findUnique({
        where: { userId_name: { userId: actor.id, name: v.name } },
      }))
    )
      throw new HttpError(400, "At most 30 saved filters");
    return tx.savedOrderFilter.upsert({
      where: { userId_name: { userId: actor.id, name: v.name } },
      create: {
        userId: actor.id,
        name: v.name,
        query: JSON.parse(JSON.stringify(q)),
      },
      update: { query: JSON.parse(JSON.stringify(q)) },
    });
  });
}
export async function detail(actor: Actor, id: string) {
  const o = await accessOrder(actor, id);
  const db = database();
  const [events, cases, comps, parcels, ledger, notes, timers, expenses] =
    await Promise.all([
      db.orderEvent.findMany({
        where: { orderId: id },
        orderBy: { recordedAt: "asc" },
      }),
      db.aftercareCase.findMany({
        where: {
          orderId: id,
          ...(actor.role === "admin" ? {} : { assigneeId: actor.id }),
        },
      }),
      db.compensation.findMany({
        where: {
          orderId: id,
          ...(actor.role === "admin" ? {} : { case: { assigneeId: actor.id } }),
        },
      }),
      db.parcel.findMany({ where: { orderId: id }, include: { lines: true } }),
      db.inventoryLedger.findMany({
        where: {
          OR: [
            { documentType: "order", documentId: id },
            {
              documentType: "replacement",
              documentId: {
                in: (
                  await db.replacementShipment.findMany({
                    where: { orderId: id },
                    select: { id: true },
                  })
                ).map((r) => r.id),
              },
            },
          ],
        },
        orderBy: { createdAt: "asc" },
      }),
      db.notification.findMany({
        where: { objectType: "order", objectId: id, conditionActive: true },
      }),
      db.orderTimer.findMany({
        where: { orderId: id },
        include: { pauses: true },
      }),
      actor.role === "admin"
        ? db.expenseLink.findMany({
            where: { objectType: "order", objectId: id },
            include: { expense: true },
          })
        : [],
    ]);
  const base =
    actor.role === "admin"
      ? o
      : {
          id: o.id,
          number: o.number,
          recipientName: o.recipientName,
          addressLine1: o.addressLine1,
          addressLine2: o.addressLine2,
          city: o.city,
          state: o.state,
          postcode: o.postcode,
          fulfillmentStatus: o.fulfillmentStatus,
          paymentStatus: o.paymentStatus,
          trackingNumber: o.trackingNumber,
          lines: o.lines.map((l) => ({
            id: l.id,
            variantId: l.variantId,
            productName: l.productName,
            sku: l.sku,
            size: l.size,
            color: l.color,
            quantity: l.quantity,
          })),
          reservations: o.reservations,
        };
  return {
    ...base,
    events:
      actor.role === "admin"
        ? events
        : events
            .filter(
              (e) =>
                !["PAYMENT_CONFIRMED", "REFUND_CONFIRMED"].includes(e.type) &&
                !e.type.startsWith("COMPENSATION"),
            )
            .map((e) => ({
              id: e.id,
              type: e.type,
              occurredAt: e.occurredAt,
              recordedAt: e.recordedAt,
              source: e.source,
            })),
    cases,
    compensations: comps,
    parcels,
    ledger,
    timers,
    expenses,
    notifications: notes
      .filter((n) => canView(actor, n))
      .map((n) => ({
        id: n.id,
        title: n.title,
        status: n.status,
        pinned: n.pinned,
        href: internalLink(n),
      })),
  };
}
export async function caseDetail(actor: Actor, id: string) {
  const c = await caseAccess(actor, id);
  return {
    ...c,
    compensations: await database().compensation.findMany({
      where: { caseId: id },
    }),
    events: await database().orderEvent.findMany({
      where: { orderId: c.orderId, after: { path: ["caseId"], equals: id } },
      orderBy: { recordedAt: "asc" },
    }),
  };
}
export async function compensationDetail(actor: Actor, id: string) {
  const c = await compensationAccess(actor, id);
  return {
    ...c,
    events: await database().orderEvent.findMany({
      where: {
        orderId: c.orderId,
        after: { path: ["compensationId"], equals: id },
      },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    }),
    replacement: await database().replacementShipment.findUnique({
      where: { compensationId: id },
    }),
    refund:
      actor.role === "admin"
        ? await database().orderRefund.findUnique({
            where: { compensationId: id },
          })
        : null,
  };
}
export async function metadata(actor: Actor) {
  staff(actor);
  const db = database();
  return {
    actor: { id: actor.id, role: actor.role },
    historicalProducts:
      actor.role === "viewer"
        ? []
        : await db.orderLine.findMany({
            distinct: ["productId"],
            select: { productId: true, productName: true },
            take: 500,
          }),
    historicalCategories:
      actor.role === "viewer"
        ? []
        : await db.orderLine.findMany({
            distinct: ["categoryId"],
            select: { categoryId: true, categoryName: true },
            take: 100,
          }),
    historicalCollections:
      actor.role === "viewer"
        ? []
        : [
            ...new Map(
              (
                await db.orderLine.findMany({
                  select: { collections: true },
                  take: 5000,
                })
              )
                .flatMap((l) => l.collections as { id: string; name: string }[])
                .map((c) => [c.id, c]),
            ).values(),
          ],
    people: await db.user.findMany({
      where: { active: true, role: { in: ["admin", "warehouse"] } },
      select: { id: true, name: true, role: true },
    }),
    capabilities:
      actor.role === "admin"
        ? [
            "orderStats",
            "orderExport",
            "customerExport",
            "orderRules",
            "compensationApply",
            "compensationExecute",
          ]
        : (
            await db.businessGrant.findMany({ where: { userId: actor.id } })
          ).map((g) => g.capability),
    recentOrders:
      actor.role === "viewer"
        ? []
        : await db.shopOrder.findMany({
            where:
              actor.role === "admin"
                ? {}
                : {
                    paymentStatus: "PAID",
                    fulfillmentStatus: { not: "CANCELLED" },
                  },
            select: { id: true, number: true },
            orderBy: { createdAt: "desc" },
            take: 200,
          }),
    filters: await db.savedOrderFilter.findMany({
      where: { userId: actor.id },
    }),
    campaigns:
      actor.role === "admin"
        ? await db.dealCampaign.findMany({
            orderBy: { startsAt: "desc" },
            take: 200,
          })
        : [],
    skus:
      actor.role === "admin"
        ? await db.productVariant.findMany({
            select: { id: true, sku: true },
            take: 500,
          })
        : [],
    today: localDay(new Date(), "Australia/Melbourne"),
  };
}
