import "server-only";
import { database } from "../db";
import { HttpError } from "../errors";
import type { Actor } from "./core";
import { staff, owner } from "./core";
import { available } from "./inventory";
import { remaining } from "./transfers";
import { publicAvailability, melbourneToday } from "./availability";
import { withActorNames } from "./annotations";
type Filters = Record<string, string | undefined>;
const text = (q: Filters, name: string) => (q[name] || "").trim().slice(0, 200);
const yes = (q: Filters, name: string) => q[name] === "true";
function date(q: Filters, name: string, end = false) {
  const s = text(q, name);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)))
    throw new HttpError(400, `Invalid ${name} date.`);
  return new Date(s + (end ? "T23:59:59.999Z" : "T00:00:00.000Z"));
}
function paginate<T>(rows: T[], q: Filters, all: boolean) {
  if (all) {
    if (rows.length > 5000)
      throw new HttpError(
        400,
        "Narrow the filters to at most 5000 rows before exporting.",
      );
    return {
      items: rows,
      total: rows.length,
      page: 1,
      pageCount: 1,
      pageSize: rows.length,
    };
  }
  const pageSize = Math.max(
    1,
    Math.min(100, Number.parseInt(q.pageSize || "25") || 25),
  );
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(
    pageCount,
    Math.max(1, Number.parseInt(q.page || "1") || 1),
  );
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
    pageCount,
  };
}
const contains = (a: string, b: string) =>
  a.toLowerCase().includes(b.toLowerCase());
export async function operationsLookup(actor: Actor) {
  staff(actor);
  const [skus, categories, collections] = await Promise.all([
    database().productVariant.findMany({
      select: {
        id: true,
        sku: true,
        size: true,
        color: true,
        product: { select: { name: true } },
      },
      orderBy: { sku: "asc" },
    }),
    database().category.findMany({
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    database().collection.findMany({
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);
  return {
    skus: skus.map((v) => ({
      id: v.id,
      name: `${v.product.name} · ${v.sku} · ${[v.size, v.color].filter(Boolean).join(" / ") || "Default"}`,
    })),
    categories,
    collections,
  };
}
export async function inventoryList(actor: Actor, q: Filters, all = false) {
  staff(actor);
  if (actor.role === "warehouse" && q.warehouse && q.warehouse !== "MELBOURNE")
    throw new HttpError(403, "Only Melbourne inventory is authorized.");
  const records = await database().productVariant.findMany({
    include: {
      product: {
        include: {
          category: true,
          collections: { include: { collection: true } },
          images: { orderBy: { sortOrder: "asc" }, take: 1 },
        },
      },
      balances: true,
      legacyStock: true,
      inventoryPolicy: true,
      transferLines: {
        include: { transfer: true },
      },
      adjustments: { where: { status: "PENDING" } },
    },
  });
  const alertRules = await database().notificationRuleSettings.findUnique({
    where: { id: "notifications" },
  });
  const alertPolicies = await database().stockAlertPolicy.findMany();
  const thresholdFor = (id: string, w: "BEIJING" | "MELBOURNE") => {
    const p = alertPolicies.find(
      (p) => p.variantId === id && p.warehouse === w,
    );
    return p?.mode === "OFF"
      ? null
      : p?.mode === "CUSTOM"
        ? p.threshold
        : ((w === "BEIJING"
            ? alertRules?.beijingThreshold
            : alertRules?.melbourneThreshold) ?? null);
  };
  const statuses = await publicAvailability(records.map((r) => r.id));
  const today = melbourneToday();
  const rows = records.map((v) => {
    const bj = v.balances.find((b) => b.warehouse === "BEIJING") ?? {
        onHand: 0,
        reserved: 0,
        unavailable: 0,
      },
      mel = v.balances.find((b) => b.warehouse === "MELBOURNE") ?? {
        onHand: 0,
        reserved: 0,
        unavailable: 0,
      };
    const transit = v.transferLines.filter(
        (l) =>
          ["SENT", "PARTIAL"].includes(l.transfer.status) && remaining(l) > 0,
      ),
      eta = transit
        .filter(
          (l) =>
            !l.transfer.exception &&
            l.transfer.etaEnd &&
            l.transfer.etaEnd.toISOString().slice(0, 10) >= today,
        )
        .sort(
          (a, b) => a.transfer.etaEnd!.getTime() - b.transfer.etaEnd!.getTime(),
        )[0]?.transfer;
    return {
      id: v.id,
      sku: v.sku,
      size: v.size,
      color: v.color,
      enabled: v.enabled,
      name: v.product.name,
      slug: v.product.slug,
      image: v.product.images[0]
        ? `/api/operations/media/${v.product.images[0].mediaId}`
        : null,
      productStatus: v.product.status,
      categoryId: v.product.categoryId,
      category: v.product.category.name,
      collections: v.product.collections.map((c) => ({
        id: c.collectionId,
        name: c.collection.name,
      })),
      beijing:
        actor.role === "warehouse"
          ? undefined
          : { ...bj, available: available(bj) },
      melbourne: { ...mel, available: available(mel) },
      inTransit: transit.reduce((n, l) => n + remaining(l), 0),
      transitEtaWindows: transit.map((l) => ({
        start: l.transfer.etaStart?.toISOString() ?? null,
        end: l.transfer.etaEnd?.toISOString() ?? null,
      })),
      etaStart: eta?.etaStart?.toISOString().slice(0, 10) ?? null,
      etaEnd: eta?.etaEnd?.toISOString().slice(0, 10) ?? null,
      overdue: transit.some(
        (l) =>
          l.transfer.etaEnd &&
          l.transfer.etaEnd.toISOString().slice(0, 10) < today,
      ),
      discrepancy:
        v.transferLines.some((l) => l.lost + l.receivedUnavailable > 0) ||
        v.adjustments.some((c) => c.countedOnHand !== c.expectedOnHand),
      pendingCounts: v.adjustments.length,
      legacyRemaining:
        actor.role === "admin" ? (v.legacyStock?.remainingQty ?? 0) : undefined,
      lowStockThreshold: thresholdFor(
        v.id,
        q.warehouse === "BEIJING" ? "BEIJING" : "MELBOURNE",
      ),
      thresholdSource:
        alertPolicies.find(
          (p) =>
            p.variantId === v.id &&
            p.warehouse ===
              (q.warehouse === "BEIJING" ? "BEIJING" : "MELBOURNE"),
        )?.mode ?? "INHERIT",
      availability: statuses.get(v.id)!.status,
    };
  });
  const from = date(q, "etaFrom"),
    to = date(q, "etaTo", true);
  const matched = rows.filter((v) => {
    const warehouse = q.warehouse === "BEIJING" ? v.beijing : v.melbourne;
    return (
      (!q.q || contains(v.name + " " + v.sku, text(q, "q"))) &&
      (!q.sku || contains(v.sku, text(q, "sku"))) &&
      (!q.size || contains(v.size, text(q, "size"))) &&
      (!q.color || contains(v.color, text(q, "color"))) &&
      (!q.category || v.categoryId === q.category) &&
      (!q.collection || v.collections.some((c) => c.id === q.collection)) &&
      (!q.status || v.productStatus === q.status) &&
      (!yes(q, "active") || (v.enabled && v.productStatus !== "ARCHIVED")) &&
      (!yes(q, "zero") || warehouse?.available === 0) &&
      (!q.availability || v.availability === q.availability) &&
      (!yes(q, "low") ||
        (v.lowStockThreshold !== null &&
          (warehouse?.available ?? 0) <= v.lowStockThreshold)) &&
      (!yes(q, "unavailable") || (warehouse?.unavailable ?? 0) > 0) &&
      (!yes(q, "transit") || v.inTransit > 0) &&
      (!yes(q, "overdue") || v.overdue) &&
      (!yes(q, "discrepancy") || v.discrepancy) &&
      (!yes(q, "pendingCounts") || v.pendingCounts > 0) &&
      (!yes(q, "legacy") || (v.legacyRemaining ?? 0) > 0) &&
      ((!from && !to) ||
        v.transitEtaWindows.some(
          (w) =>
            (!from || (!!w.end && new Date(w.end) >= from)) &&
            (!to || (!!w.start && new Date(w.start) <= to)),
        ))
    );
  });
  const sort = q.sort || "sku";
  matched.sort((a, b) =>
    sort === "available-asc"
      ? a.melbourne.available - b.melbourne.available ||
        a.sku.localeCompare(b.sku)
      : sort === "transit-desc"
        ? b.inTransit - a.inTransit || a.sku.localeCompare(b.sku)
        : sort === "name"
          ? a.name.localeCompare(b.name)
          : a.sku.localeCompare(b.sku),
  );
  return {
    ...paginate(matched, q, all),
    alerts: {
      lowStock: rows.filter(
        (r) =>
          r.lowStockThreshold !== null &&
          (q.warehouse === "BEIJING"
            ? (r.beijing?.available ?? 0)
            : r.melbourne.available) <= r.lowStockThreshold,
      ).length,
      overdue: rows.filter((r) => r.overdue).length,
      pendingCounts: rows.reduce((n, r) => n + r.pendingCounts, 0),
      ...(actor.role === "admin"
        ? {
            legacyUnassigned: rows.reduce(
              (n, r) => n + (r.legacyRemaining ?? 0),
              0,
            ),
          }
        : {}),
    },
  };
}
export async function transferList(actor: Actor, q: Filters) {
  staff(actor);
  const rows = await database().transfer.findMany({
    include: { lines: true },
    orderBy: { createdAt: "desc" },
  });
  const today = melbourneToday();
  return paginate(
    rows
      .filter(
        (t) =>
          (!q.q || contains(t.number + " " + t.trackingNumber, text(q, "q"))) &&
          (!q.status || t.status === q.status) &&
          (!yes(q, "awaitingReceipt") ||
            (["SENT", "PARTIAL"].includes(t.status) &&
              t.lines.some((l) => remaining(l) > 0))) &&
          (!yes(q, "overdue") ||
            (["SENT", "PARTIAL"].includes(t.status) &&
              !!t.etaEnd &&
              t.etaEnd.toISOString().slice(0, 10) < today)) &&
          (!yes(q, "discrepancy") ||
            t.exception ||
            t.lines.some((l) => l.lost + l.receivedUnavailable > 0)),
      )
      .map((t) => ({
        ...t,
        overdue:
          ["SENT", "PARTIAL"].includes(t.status) &&
          !!t.etaEnd &&
          t.etaEnd.toISOString().slice(0, 10) < today,
        remaining: t.lines.reduce((n, l) => n + remaining(l), 0),
      })),
    q,
    false,
  );
}

export async function auditHistory(actor: Actor, q: Filters) {
  owner(actor);
  const rows = await database().auditLog.findMany({
    where: {
      ...(q.objectType ? { objectType: q.objectType } : {}),
      ...(q.objectId ? { objectId: q.objectId } : {}),
      ...(q.q
        ? {
            OR: [
              { action: { contains: q.q.slice(0, 200), mode: "insensitive" } },
              { reason: { contains: q.q.slice(0, 200), mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  return { ...paginate(await withActorNames(rows), q, false) };
}
export async function countList(actor: Actor) {
  staff(actor);
  return database().stockAdjustment.findMany({
    where: actor.role === "warehouse" ? { warehouse: "MELBOURNE" } : {},
    include: { variant: { select: { sku: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
export async function orderList(actor: Actor, q: Filters, all = false) {
  staff(actor);
  if (all) owner(actor);
  if (actor.role === "viewer")
    throw new HttpError(
      403,
      "This read-only account is authorized for inventory and transfers only.",
    );
  const rows = await database().shopOrder.findMany({
    where:
      actor.role === "warehouse"
        ? { paymentStatus: "PAID", fulfillmentStatus: { not: "CANCELLED" } }
        : {},
    include: { lines: true },
    orderBy: { createdAt: "desc" },
  });
  const from = date(q, "from"),
    to = date(q, "to", true),
    timeField = ["createdAt", "paidAt", "shippedAt"].includes(q.timeField || "")
      ? (q.timeField as "createdAt" | "paidAt" | "shippedAt")
      : "createdAt";
  const hasLineFilter =
    [
      "product",
      "sku",
      "size",
      "color",
      "category",
      "collection",
      "discountSource",
    ].some((k) => !!q[k]) || yes(q, "deals");
  const lineMatches = (l: (typeof rows)[number]["lines"][number]) =>
    (!q.product || contains(l.productName, text(q, "product"))) &&
    (!q.sku || contains(l.sku, text(q, "sku"))) &&
    (!q.size || contains(l.size, text(q, "size"))) &&
    (!q.color || contains(l.color, text(q, "color"))) &&
    (!q.category || l.categoryId === q.category) &&
    (!q.collection ||
      (Array.isArray(l.collections) &&
        l.collections.some(
          (c) =>
            c && typeof c === "object" && "id" in c && c.id === q.collection,
        ))) &&
    (!yes(q, "deals") || l.discountSource === "MARKDOWN") &&
    (!q.discountSource || l.discountSource === q.discountSource);
  const amount = (field: string) => {
    const n = text(q, field);
    if (n && !/^\d{1,10}$/.test(n))
      throw new HttpError(
        400,
        "Amounts must be non-negative integer AUD cents.",
      );
    return n ? Number(n) : null;
  };
  const min = amount("minCents"),
    max = amount("maxCents");
  if (actor.role !== "admin" && (q.minCents || q.maxCents || q.email))
    throw new HttpError(
      403,
      "These financial/customer filters require owner permission.",
    );
  if (q.currency && q.currency !== "AUD")
    throw new HttpError(400, "Only AUD orders are supported.");
  const matched = rows.filter((o) => {
    const time = o[timeField];
    const qFields =
      actor.role === "admin"
        ? [o.number, o.email, o.recipientName, o.trackingNumber]
        : [o.number, o.trackingNumber];
    return (
      (!q.q || contains(qFields.join(" "), text(q, "q"))) &&
      (!q.email || contains(o.email, text(q, "email"))) &&
      (!q.payment || o.paymentStatus === q.payment) &&
      (!q.fulfillment || o.fulfillmentStatus === q.fulfillment) &&
      (!q.state || o.state === q.state) &&
      (!q.postcode || contains(o.postcode, text(q, "postcode"))) &&
      (!q.carrier || contains(o.carrier, text(q, "carrier"))) &&
      (!q.shippingMethod || q.shippingMethod === "FIXED_AU") &&
      (!yes(q, "cancelled") || !!o.cancelledAt) &&
      (!yes(q, "exceptions") || !!o.exception) &&
      (!yes(q, "overdue") ||
        (o.paymentStatus === "PAID" &&
          o.fulfillmentStatus === "UNFULFILLED" &&
          !!o.paidAt &&
          o.paidAt.getTime() < Date.now() - 2 * 86400000)) &&
      (!from || (!!time && time >= from)) &&
      (!to || (!!time && time <= to)) &&
      (min === null || o.totalCents >= min) &&
      (max === null || o.totalCents <= max) &&
      (!hasLineFilter || o.lines.some(lineMatches))
    );
  });
  if (q.sort === "total-asc" || q.sort === "total-desc") {
    owner(actor);
    matched.sort(
      (a, b) =>
        (q.sort === "total-asc" ? 1 : -1) * (a.totalCents - b.totalCents),
    );
  } else if (q.sort === "oldest")
    matched.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const stats =
    actor.role === "admin"
      ? {
          orders: matched.length,
          wholeOrderCents: matched.reduce((n, o) => n + o.totalCents, 0),
          matchedItemCents: matched.reduce(
            (n, o) =>
              n +
              o.lines
                .filter((l) => !hasLineFilter || lineMatches(l))
                .reduce((m, l) => m + l.lineTotalCents, 0),
            0,
          ),
          matchedDiscountCents: matched.reduce(
            (n, o) =>
              n +
              o.lines
                .filter((l) => !hasLineFilter || lineMatches(l))
                .reduce((m, l) => m + l.discountCents, 0),
            0,
          ),
          recordedRefundCents: matched.reduce(
            (n, o) => n + o.recordedRefundCents,
            0,
          ),
        }
      : undefined;
  const result = paginate(
    matched.map((o) => ({
      id: o.id,
      number: o.number,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      shippedAt: o.shippedAt,
      paymentStatus: o.paymentStatus,
      fulfillmentStatus: o.fulfillmentStatus,
      trackingNumber: o.trackingNumber,
      carrier: o.carrier,
      exception: o.exception,
      itemCount: o.lines.reduce((n, l) => n + l.quantity, 0),
      ...(actor.role === "admin"
        ? {
            email: o.email,
            recipientName: o.recipientName,
            state: o.state,
            postcode: o.postcode,
            totalCents: o.totalCents,
            currency: o.currency,
            discountCents: o.discountCents,
            matchedItemCents: o.lines
              .filter((l) => !hasLineFilter || lineMatches(l))
              .reduce((n, l) => n + l.lineTotalCents, 0),
          }
        : {}),
    })),
    q,
    all,
  );
  const cat = new Map<string, Set<string>>(),
    col = new Map<string, Set<string>>();
  for (const o of rows)
    for (const l of o.lines) {
      cat.set(
        l.categoryId,
        new Set([...(cat.get(l.categoryId) ?? []), l.categoryName]),
      );
      if (Array.isArray(l.collections))
        for (const c of l.collections) {
          if (
            c &&
            typeof c === "object" &&
            "id" in c &&
            "name" in c &&
            typeof c.id === "string" &&
            typeof c.name === "string"
          )
            col.set(c.id, new Set([...(col.get(c.id) ?? []), c.name]));
        }
    }
  const facet = (m: Map<string, Set<string>>) =>
    [...m].map(([id, names]) => ({ id, name: [...names].join(" / ") }));
  return {
    ...result,
    stats,
    facets: { categories: facet(cat), collections: facet(col) },
  };
}
