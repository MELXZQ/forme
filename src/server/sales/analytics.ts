import "server-only";
import { z } from "zod";
import { database } from "../db";
import { HttpError } from "../errors";
import { audit, csv, type Actor } from "../operations/core";
import { day, zone } from "../business/common";
import { permit } from "./access";
import { filterSchema, range, lineWhere, cleanQuery } from "./queries";
import { localDay } from "../notifications/time";
const schema = z
  .object({
    from: day,
    to: day,
    asOf: day,
    timezone: zone.default("Australia/Melbourne"),
    dataKind: z.enum(["REAL", "TEST"]).default("REAL"),
    bucket: z.enum(["day", "week", "month"]).default("day"),
    product: z.string().optional(),
    sku: z.string().optional(),
    category: z.string().optional(),
    collection: z.string().optional(),
    campaign: z.string().optional(),
    format: z.literal("csv").optional(),
  })
  .strict()
  .refine(
    (v) => v.from <= v.to && v.asOf >= v.to,
    "Data cutoff must include the report period",
  );
export const bucketDay = (
  d: Date,
  timezone: "Australia/Melbourne" | "Asia/Shanghai",
  bucket: string,
) => {
  const s = localDay(d, timezone);
  if (bucket === "month") return s.slice(0, 7);
  if (bucket === "week") {
    const date = new Date(s),
      dow = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - ((dow + 6) % 7));
    return date.toISOString().slice(0, 10);
  }
  return s;
};
const band = (n: number) =>
  n < 5000
    ? "[0,50)"
    : n < 10000
      ? "[50,100)"
      : n < 20000
        ? "[100,200)"
        : "[200,+∞)";
export async function analytics(actor: Actor, raw: Record<string, unknown>) {
  await permit(actor, "orderStats");
  const q = schema.parse(cleanQuery(raw)),
    db = database();
  const period = range(q),
    cutoff = range({ ...q, from: undefined, to: q.asOf }).lt!;
  const duration = period.lt!.getTime() - period.gte!.getTime();
  if (duration > 3 * 366 * 86400000)
    throw new HttpError(400, "Report range is limited to three years");
  const lineFilter = lineWhere(
    filterSchema.parse({
      product: q.product,
      sku: q.sku,
      category: q.category,
      collection: q.collection,
      campaign: q.campaign,
    }),
  );
  const scopedOrder = {
    currency: "AUD",
    dataKind: q.dataKind,
    lines: { some: lineFilter },
  };
  const payments = await db.orderEvent.findMany({
    where: {
      type: "PAYMENT_SUCCEEDED",
      dataKind: q.dataKind,
      occurredAt: period,
      order: scopedOrder,
    },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    take: 10001,
  });
  if (payments.length > 10000)
    throw new HttpError(400, "Narrow the report to 10000 payment events");
  const ids = [...new Set(payments.map((e) => e.orderId))];
  const orders = await db.shopOrder.findMany({
    where: { id: { in: ids } },
    include: {
      lines: true,
      refunds: { where: { occurredAt: { lt: cutoff }, dataKind: q.dataKind } },
      cases: true,
    },
  });
  const matching = await db.orderLine.findMany({
    where: { orderId: { in: ids }, ...lineFilter },
  });
  const matchIds = new Set(matching.map((l) => l.id));
  const refunds = await db.orderRefund.findMany({
    where: { dataKind: q.dataKind, occurredAt: period, order: scopedOrder },
  });
  const previous = {
    gte: new Date(period.gte!.getTime() - duration),
    lt: period.gte,
  };
  const prior = await db.orderEvent.aggregate({
    where: {
      type: "PAYMENT_SUCCEEDED",
      dataKind: q.dataKind,
      occurredAt: previous,
      order: scopedOrder,
    },
    _sum: { amountCents: true },
    _count: true,
  });
  const byTime = new Map<
    string,
    {
      period: string;
      orders: number;
      units: number;
      merchandise: number;
      discount: number;
      shipping: number;
      received: number;
      refunded: number;
    }
  >();
  const point = (d: Date) => {
    const k = bucketDay(d, q.timezone, q.bucket);
    if (!byTime.has(k))
      byTime.set(k, {
        period: k,
        orders: 0,
        units: 0,
        merchandise: 0,
        discount: 0,
        shipping: 0,
        received: 0,
        refunded: 0,
      });
    return byTime.get(k)!;
  };
  const groups: Record<
    string,
    Map<
      string,
      {
        id: string;
        name: string;
        units: number;
        amount: number;
        discount: number;
        orderIds: Set<string>;
        refund: number;
      }
    >
  > = {
    sku: new Map(),
    product: new Map(),
    category: new Map(),
    collection: new Map(),
    campaign: new Map(),
    unitBand: new Map(),
  };
  const orderBands: Record<string, number> = {},
    states: Record<string, number> = {},
    reasons: Record<string, number> = {};
  const elapsedShip: number[] = [],
    elapsedDelivery: number[] = [];
  let unshipped = 0,
    undelivered = 0,
    unknownDiscount = 0,
    unattributed = 0;
  for (const o of orders) {
    const pay = payments.find((e) => e.orderId === o.id)!;
    const p = point(pay.occurredAt!);
    p.orders++;
    p.shipping += o.shippingCents;
    p.received += pay.amountCents ?? 0;
    orderBands[band(o.totalCents)] = (orderBands[band(o.totalCents)] ?? 0) + 1;
    states[o.state] = (states[o.state] ?? 0) + 1;
    if (o.shippedAt && o.shippedAt < cutoff && o.shippedAt >= pay.occurredAt!)
      elapsedShip.push(o.shippedAt.getTime() - pay.occurredAt!.getTime());
    else unshipped++;
    if (
      o.deliveredAt &&
      o.deliveredAt < cutoff &&
      o.shippedAt &&
      o.deliveredAt >= o.shippedAt
    )
      elapsedDelivery.push(o.deliveredAt.getTime() - o.shippedAt.getTime());
    else undelivered++;
    for (const c of o.cases.filter(
      (c) => q.dataKind === "TEST" || c.source !== "TEST",
    ))
      reasons[c.type] = (reasons[c.type] ?? 0) + 1;
    for (const l of o.lines.filter((l) => matchIds.has(l.id))) {
      p.units += l.quantity;
      p.merchandise += l.lineTotalCents;
      p.discount += l.actualDiscountCents ?? 0;
      if (l.actualDiscountCents === null) unknownDiscount++;
      const cols = l.collections as { id: string; name: string }[],
        campaigns = l.campaigns as { id: string; name: string }[];
      if (!campaigns.length) unattributed += l.lineTotalCents;
      const dims: { kind: string; id: string; name: string }[] = [
        { kind: "sku", id: l.variantId, name: l.sku },
        { kind: "product", id: l.productId, name: l.productName },
        { kind: "category", id: l.categoryId, name: l.categoryName },
        {
          kind: "unitBand",
          id: band(l.unitPriceCents),
          name: band(l.unitPriceCents),
        },
        ...cols.map((c) => ({ kind: "collection", ...c })),
        ...campaigns.map((c) => ({ kind: "campaign", ...c })),
      ];
      const allocated = o.refunds
        .flatMap(
          (r) => r.allocations as { lineId: string; amountCents: number }[],
        )
        .filter((a) => a.lineId === l.id)
        .reduce((n, a) => n + a.amountCents, 0);
      for (const d of dims) {
        const map = groups[d.kind],
          g = map.get(d.id) ?? {
            id: d.id,
            name: d.name,
            units: 0,
            amount: 0,
            discount: 0,
            orderIds: new Set<string>(),
            refund: 0,
          };
        g.units += l.quantity;
        g.amount += l.lineTotalCents;
        g.discount += l.actualDiscountCents ?? 0;
        g.refund += allocated;
        g.orderIds.add(o.id);
        map.set(d.id, g);
      }
    }
  }
  for (const r of refunds) point(r.occurredAt).refunded += r.amountCents;
  const trend = [...byTime.values()].sort((a, b) =>
    a.period.localeCompare(b.period),
  );
  const totals = trend.reduce(
    (a, p) => ({
      orders: a.orders + p.orders,
      units: a.units + p.units,
      merchandise: a.merchandise + p.merchandise,
      discount: a.discount + p.discount,
      shipping: a.shipping + p.shipping,
      received: a.received + p.received,
      refunded: a.refunded + p.refunded,
    }),
    {
      orders: 0,
      units: 0,
      merchandise: 0,
      discount: 0,
      shipping: 0,
      received: 0,
      refunded: 0,
    },
  );
  const cancelled = await db.orderEvent.findMany({
    where: {
      type: "ORDER_CANCELLED",
      dataKind: q.dataKind,
      occurredAt: period,
      order: scopedOrder,
    },
    select: { orderId: true },
  });
  const cancellationAudits = await db.auditLog.findMany({
    where: {
      action: "ORDER_CANCELLED",
      objectId: { in: cancelled.map((x) => x.orderId) },
    },
  });
  const cancellationReasons: Record<string, number> = {};
  for (const a of cancellationAudits)
    cancellationReasons[a.reason] = (cancellationReasons[a.reason] ?? 0) + 1;
  const outstanding = await db.orderTimer.count({
    where: {
      active: true,
      kind: { in: ["SHIPMENT", "DELIVERY"] },
      deadlineAt: { lt: new Date() },
      pauses: {
        none: { startsAt: { lte: new Date() }, endsAt: { gt: new Date() } },
      },
      orderId: { in: ids },
    },
  });
  const unknownHistory = await db.shopOrder.count({
    where: { dataKind: "UNKNOWN", paymentStatus: "PAID" },
  });
  const avg = (values: number[]) => ({
    sample: values.length,
    averageHours: values.length
      ? values.reduce((a, b) => a + b, 0) / values.length / 3600000
      : null,
  });
  const rows = orders.map((o) => ({
    id: o.id,
    number: o.number,
    paidAt: payments.find((e) => e.orderId === o.id)!.occurredAt,
    orderCents: o.totalCents,
    matchedCents: o.lines
      .filter((l) => matchIds.has(l.id))
      .reduce((n, l) => n + l.lineTotalCents, 0),
    cohortRefundCents: o.refunds.reduce((n, r) => n + r.amountCents, 0),
  }));
  // Reliable stock intervals begin at the first recorded balance, never at product creation.
  const ledger = await db.inventoryLedger.findMany({
    where: {
      warehouse: "MELBOURNE",
      variantId: { in: [...new Set(matching.map((l) => l.variantId))] },
      createdAt: { lt: cutoff },
    },
    orderBy: [{ variantId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: 50001,
  });
  const stockHistoryLimited = ledger.length > 50000;
  const stockout: Record<
    string,
    { skuId: string; knownSince: Date; hours: number }
  > = {};
  if (!stockHistoryLimited)
    for (let i = 0; i < ledger.length; i++) {
      const l = ledger[i];
      const item = stockout[l.variantId] ?? {
        skuId: l.variantId,
        knownSince: l.createdAt,
        hours: 0,
      };
      const next =
        ledger[i + 1]?.variantId === l.variantId
          ? ledger[i + 1].createdAt
          : cutoff;
      const start = Math.max(l.createdAt.getTime(), period.gte!.getTime()),
        end = Math.min(next.getTime(), period.lt!.getTime());
      if (
        l.afterOnHand - l.afterReserved - l.afterUnavailable <= 0 &&
        end > start
      )
        item.hours += (end - start) / 3600000;
      stockout[l.variantId] = item;
    }
  const campaignComparison: {
    window: string;
    from: string;
    to: string;
    orders: number;
    units: number;
    merchandise: number;
  }[] = [];
  let campaignComparisonVersion: number | null = null;
  if (q.campaign) {
    const c = await db.dealCampaign.findUnique({ where: { id: q.campaign } });
    if (c) {
      campaignComparisonVersion = c.version;
      const span = c.endsAt.getTime() - c.startsAt.getTime();
      if (span <= 3 * 366 * 86400000)
        for (const [window, offset] of [
          ["Before", -1],
          ["During", 0],
          ["After", 1],
        ] as const) {
          const start = new Date(c.startsAt.getTime() + span * offset),
            end = new Date(c.startsAt.getTime() + span * (offset + 1));
          if (start >= cutoff) continue;
          const es = await db.orderEvent.findMany({
            where: {
              type: "PAYMENT_SUCCEEDED",
              dataKind: q.dataKind,
              occurredAt: { gte: start, lt: end < cutoff ? end : cutoff },
              order: {
                currency: "AUD",
                lines: { some: { variantId: { in: c.variantIds } } },
              },
            },
            select: { orderId: true },
            take: 10001,
          });
          if (es.length > 10000)
            throw new HttpError(
              400,
              "Narrow campaign comparison to 10000 payments",
            );
          const matching = await db.orderLine.aggregate({
            where: {
              orderId: { in: es.map((e) => e.orderId) },
              variantId: { in: c.variantIds },
            },
            _sum: { quantity: true, lineTotalCents: true },
          });
          campaignComparison.push({
            window,
            from: start.toISOString(),
            to: (end < cutoff ? end : cutoff).toISOString(),
            orders: new Set(es.map((e) => e.orderId)).size,
            units: matching._sum.quantity ?? 0,
            merchandise: matching._sum.lineTotalCents ?? 0,
          });
        }
    }
  }
  const result = {
    campaignComparison,
    campaignComparisonVersion,
    refundsWithoutLineAllocation: orders
      .flatMap((o) => o.refunds)
      .reduce(
        (n, r) =>
          n +
          r.amountCents -
          (r.allocations as { amountCents: number }[]).reduce(
            (n, a) => n + a.amountCents,
            0,
          ),
        0,
      ),
    filters: q,
    generatedAt: new Date(),
    currency: "AUD",
    tax: "Not separately collected by the existing checkout",
    totals: {
      ...totals,
      net: totals.received - totals.refunded,
      averageOrderCents: totals.orders
        ? Math.round(totals.received / totals.orders)
        : null,
      cancelledOrders: new Set(cancelled.map((c) => c.orderId)).size,
      refundedOrders: new Set(refunds.map((r) => r.orderId)).size,
      unknownDiscountLines: unknownDiscount,
    },
    trend,
    dimensions: Object.fromEntries(
      Object.entries(groups).map(([k, m]) => [
        k,
        [...m.values()]
          .map((g) => ({ ...g, orders: g.orderIds.size, orderIds: undefined }))
          .sort((a, b) => b.amount - a.amount),
      ]),
    ),
    orderBands,
    states,
    aftercareReasons: reasons,
    cancellationReasons,
    cohort: {
      refundThrough: q.asOf,
      refundCents: rows.reduce((n, r) => n + r.cohortRefundCents, 0),
      orders: rows.length,
    },
    previous: {
      from: previous.gte,
      to: previous.lt,
      received: prior._sum.amountCents ?? 0,
      changePercent: prior._sum.amountCents
        ? (100 * (totals.received - prior._sum.amountCents)) /
          prior._sum.amountCents
        : null,
    },
    fulfillment: {
      shipping: avg(elapsedShip),
      delivery: avg(elapsedDelivery),
      unshipped,
      undelivered,
      overdue: outstanding,
    },
    stockout: stockHistoryLimited ? [] : Object.values(stockout),
    stockHistoryLimited,
    unknownHistoricalPaidOrders: unknownHistory,
    unattributedMerchandise: unattributed,
    rows,
    notes: [
      "Amounts in AUD cents. Net receipts are not profit.",
      "Collection/campaign dimensions overlap: do not add them to obtain totals.",
      "Sales follow payment time; refunds follow actual refund time. Refunds do not reduce units without a physical return.",
      "Compare-at differences are reference savings, not actual applied discounts.",
      "Campaign attribution is association only, not incremental revenue or conversion.",
      "Partial refund attribution remains unknown unless supported by line allocation.",
      "Previous period uses equal elapsed duration. No baseline means no percentage change.",
    ],
  };
  if (q.format === "csv") {
    await permit(actor, "orderExport");
    await db.$transaction((tx) =>
      audit(
        tx,
        actor,
        "STATS_EXPORT",
        "export",
        "analytics",
        "Authorized statistics export",
        undefined,
        { filters: q, count: rows.length },
      ),
    );
    return csv([
      [
        "Sales report",
        q.dataKind,
        q.timezone,
        q.from,
        q.to,
        "cutoff " + q.asOf,
        "AUD cents",
      ],
      ["Filters", JSON.stringify(q)],
      [
        "period",
        "paid orders",
        "units",
        "matched merchandise",
        "discount known",
        "shipping",
        "receipts",
        "refunds",
      ],
      ...trend.map((p) => [
        p.period,
        p.orders,
        p.units,
        p.merchandise,
        p.discount,
        p.shipping,
        p.received,
        p.refunded,
      ]),
      [],
      ["order", "paid time", "whole order", "matched lines", "cohort refund"],
      ...rows.map((r) => [
        r.number,
        r.paidAt?.toISOString(),
        r.orderCents,
        r.matchedCents,
        r.cohortRefundCents,
      ]),
    ]);
  }
  return result;
}
