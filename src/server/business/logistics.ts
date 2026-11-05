import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { database } from "../db";
import { HttpError } from "../errors";
import { staff, warehouseAccess } from "../operations/core";
import {
  permit,
  allowed,
  command,
  audit,
  lock,
  assignee,
  base,
  ident,
  text,
  day,
  zone,
  occurred,
  date,
  plain,
  qty,
  type Actor,
  type Tx,
} from "./common";
import { canView } from "../notifications/access";
import { remainingPurchase } from "./purchases";
export async function parcelPermission(
  actor: Actor,
  p: { warehouse: string | null; type: string },
  write = false,
  tx?: Tx,
) {
  staff(actor, write);
  if (actor.role === "admin") return;
  if (
    actor.role === "warehouse" &&
    (p.warehouse === "MELBOURNE" ||
      p.type === "CUSTOMER_DELIVERY" ||
      p.type === "CUSTOMER_RETURN")
  )
    return;
  if ((await allowed(actor, "logistics", tx)) && actor.role !== "viewer") {
    if (actor.role === "warehouse" && p.warehouse === "BEIJING")
      throw new HttpError(403, "Beijing receiving rights remain owner-only");
    return;
  }
  throw new HttpError(404, "Logistics record not found");
}
const parcelSchema = z
  .object({
    ...base,
    type: z.enum([
      "SUPPLIER_INBOUND",
      "TRANSFER",
      "CUSTOMER_DELIVERY",
      "CUSTOMER_RETURN",
      "SUPPLIER_RETURN",
      "OTHER",
    ]),
    purchaseId: ident.nullable().default(null),
    transferId: ident.nullable().default(null),
    orderId: ident.nullable().default(null),
    returnId: ident.nullable().default(null),
    assigneeId: ident,
    sourcePlace: z.string().trim().min(1).max(200),
    destinationPlace: z.string().trim().min(1).max(200),
    warehouse: z.enum(["BEIJING", "MELBOURNE"]).nullable(),
    timezone: zone,
    sender: z.string().trim().min(1).max(500),
    recipient: z.string().trim().min(1).max(500),
    carrier: text,
    trackingNumber: text,
    packageCount: qty.min(1).max(1000),
    weightGrams: qty.nullable().default(null),
    etaStart: day.nullable(),
    etaEnd: day.nullable(),
    notes: text,
    trackingReuseReason: text,
    lines: z
      .array(
        z.object({
          variantId: ident,
          purchaseLineId: ident.nullable().default(null),
          quantity: qty.min(1),
        }),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    (v) => !v.etaStart || !v.etaEnd || v.etaStart <= v.etaEnd,
    "Invalid ETA range",
  )
  .refine(
    (v) => new Set(v.lines.map((l) => l.variantId)).size === v.lines.length,
    "Duplicate SKU",
  );
export async function createParcel(actor: Actor, input: unknown) {
  const v = parcelSchema.parse(input);
  await parcelPermission(actor, v, true);
  return command(actor, "parcel-create", v.key, v, async (tx) => {
    await assignee(tx, v.assigneeId);
    if (
      (v.type === "SUPPLIER_INBOUND" && !v.purchaseId) ||
      (v.type === "TRANSFER" && !v.transferId) ||
      (v.type === "CUSTOMER_DELIVERY" && !v.orderId)
    )
      throw new HttpError(400, "Select the related business record");
    if ([v.purchaseId, v.transferId, v.orderId].filter(Boolean).length > 1)
      throw new HttpError(400, "A parcel has one primary business source");
    if (v.trackingNumber) {
      await lock(tx, "tracking:" + v.carrier + ":" + v.trackingNumber);
      if (
        (await tx.parcel.count({
          where: { carrier: v.carrier, trackingNumber: v.trackingNumber },
        })) &&
        v.trackingReuseReason.trim().length < 3
      )
        throw new HttpError(
          409,
          "This carrier/tracking number already exists. Check it, or explain legitimate reuse.",
        );
    }
    if (v.purchaseId) {
      await lock(tx, "purchase:" + v.purchaseId);
      const p = await tx.purchase.findUniqueOrThrow({
        where: { id: v.purchaseId },
        include: { lines: true },
      });
      warehouseAccess(actor, p.warehouse, true);
      if (
        v.type === "SUPPLIER_INBOUND" &&
        (p.status !== "CONFIRMED" || p.warehouse !== v.warehouse)
      )
        throw new HttpError(400, "Use the confirmed purchase destination");
      if (!["SUPPLIER_INBOUND", "SUPPLIER_RETURN"].includes(v.type))
        throw new HttpError(400, "Invalid purchase parcel type");
      if (v.type === "SUPPLIER_RETURN") {
        const r = await tx.supplierReturn.findUniqueOrThrow({
          where: { id: v.returnId ?? "" },
          include: { lines: true },
        });
        if (r.purchaseId !== p.id)
          throw new HttpError(400, "Return does not belong to purchase");
        for (const l of v.lines) {
          if (
            !p.lines.some(
              (x) => x.id === l.purchaseLineId && x.variantId === l.variantId,
            )
          )
            throw new HttpError(
              400,
              "Return SKU does not match its purchase line",
            );
          const allocated = await tx.parcelLine.aggregate({
            where: {
              purchaseLineId: l.purchaseLineId,
              parcel: { returnId: r.id, type: "SUPPLIER_RETURN" },
            },
            _sum: { quantity: true },
          });
          if (
            !r.lines.some(
              (x) =>
                x.lineId === l.purchaseLineId &&
                x.sellable + x.unavailable >=
                  l.quantity + (allocated._sum.quantity ?? 0),
            )
          )
            throw new HttpError(400, "Parcel exceeds recorded return");
        }
      } else {
        for (const l of v.lines) {
          const line = p.lines.find(
            (x) => x.id === l.purchaseLineId && x.variantId === l.variantId,
          );
          if (!line)
            throw new HttpError(400, "Choose a matching purchase line");
          const allocations = await tx.parcelLine.findMany({
            where: {
              purchaseLineId: line.id,
              parcel: {
                type: "SUPPLIER_INBOUND",
                transportStatus: { notIn: ["RETURNED", "LOST"] },
              },
            },
            include: {
              parcel: { include: { receipts: { include: { lines: true } } } },
            },
          });
          const pending = allocations.reduce(
            (n, x) =>
              n +
              Math.max(
                0,
                x.quantity -
                  x.parcel.receipts
                    .flatMap((r) => r.lines)
                    .filter((r) => r.lineId === line.id)
                    .reduce((m, r) => m + r.sellable + r.unavailable, 0),
              ),
            0,
          );
          if (pending + l.quantity > remainingPurchase(line))
            throw new HttpError(
              409,
              "Parcel allocations exceed the purchase commitment",
            );
        }
      }
    }
    if (v.transferId) {
      const t = await tx.transfer.findUniqueOrThrow({
        where: { id: v.transferId },
        include: { lines: true },
      });
      await lock(tx, "transfer:" + t.id);
      if (v.type !== "TRANSFER")
        throw new HttpError(400, "Choose transfer type");
      for (const l of v.lines) {
        const source = t.lines.find((x) => x.variantId === l.variantId);
        const existing = await tx.parcelLine.aggregate({
          where: { variantId: l.variantId, parcel: { transferId: t.id } },
          _sum: { quantity: true },
        });
        if (!source || (existing._sum.quantity ?? 0) + l.quantity > source.sent)
          throw new HttpError(
            409,
            "Allocate only already dispatched transfer quantities",
          );
      }
    }
    if (
      (v.type === "SUPPLIER_RETURN" && !v.purchaseId) ||
      (v.type === "CUSTOMER_RETURN" && !v.orderId)
    )
      throw new HttpError(400, "Return transport requires its source record");
    if (v.orderId) {
      if (!["CUSTOMER_DELIVERY", "CUSTOMER_RETURN"].includes(v.type))
        throw new HttpError(400, "Invalid order parcel type");
      const o = await tx.shopOrder.findUniqueOrThrow({
        where: { id: v.orderId },
        include: { lines: true },
      });
      await lock(tx, "order:" + o.id);
      if (v.type === "CUSTOMER_DELIVERY" && !o.shippedAt)
        throw new HttpError(
          409,
          "Ship through the existing order service first; logistics never deducts stock",
        );
      if (v.type === "CUSTOMER_RETURN") {
        const r = await tx.orderReturn.findUniqueOrThrow({
          where: { id: v.returnId ?? "" },
          include: { line: true },
        });
        if (
          r.orderId !== o.id ||
          v.lines.some(
            (l) =>
              l.variantId !== r.line.variantId ||
              l.quantity > r.sellable + r.unavailable,
          )
        )
          throw new HttpError(
            400,
            "Choose a matching recorded customer return",
          );
      }
      for (const l of v.lines) {
        const expected = o.lines
          .filter((x) => x.variantId === l.variantId)
          .reduce((n, x) => n + x.quantity, 0);
        const existing = await tx.parcelLine.aggregate({
          where: {
            variantId: l.variantId,
            parcel: { orderId: o.id, type: v.type },
          },
          _sum: { quantity: true },
        });
        if ((existing._sum.quantity ?? 0) + l.quantity > expected)
          throw new HttpError(409, "Parcel exceeds order quantities");
      }
    }
    if (!v.purchaseId && v.lines.some((l) => l.purchaseLineId))
      throw new HttpError(400, "Purchase line requires its purchase");
    const { key, reason, trackingReuseReason, lines, ...data } = v;
    void key;
    const p = await tx.parcel.create({
      data: {
        ...data,
        etaStart: date(v.etaStart),
        etaEnd: date(v.etaEnd),
        number: "PK-" + randomUUID().slice(0, 12).toUpperCase(),
        createdBy: actor.id,
        lines: { create: lines },
      },
    });
    await tx.parcelEvent.create({
      data: {
        parcelId: p.id,
        reference: "created",
        event: "CREATED",
        actorId: actor.id,
        source: "MANUAL",
        occurredAt: new Date(),
        reason: v.reason,
        before: {},
        after: plain({ ...p, trackingReuseReason }),
      },
    });
    await audit(
      tx,
      actor,
      "PARCEL_CREATED",
      "parcel",
      p.id,
      reason,
      undefined,
      { ...p, trackingReuseReason },
    );
    return { id: p.id };
  });
}
export async function parcelEvent(actor: Actor, id: string, input: unknown) {
  const v = z
    .object({
      ...base,
      event: z.enum([
        "DISPATCHED",
        "IN_TRANSIT",
        "SIGNED",
        "EXCEPTION",
        "LOST",
        "RETURNED",
        "ETA_CHANGED",
        "NOTE",
      ]),
      reference: z.string().trim().min(3).max(150),
      occurredAt: occurred,
      source: z.enum(["MANUAL", "TEST"]),
      etaStart: day.nullable().default(null),
      etaEnd: day.nullable().default(null),
    })
    .strict()
    .refine(
      (v) => !v.etaStart || !v.etaEnd || v.etaStart <= v.etaEnd,
      "Invalid ETA",
    )
    .parse(input);
  return command(actor, "parcel-event", v.key, { id, ...v }, async (tx) => {
    await lock(tx, "parcel:" + id);
    const p = await tx.parcel.findUniqueOrThrow({ where: { id } });
    await parcelPermission(actor, p, true, tx);
    if (["LOST", "RETURNED"].includes(v.event))
      await permit(actor, "logistics", tx);
    const old = await tx.parcelEvent.findUnique({
      where: {
        parcelId_source_reference: {
          parcelId: id,
          source: v.source,
          reference: v.reference,
        },
      },
    });
    if (old) {
      if (old.event !== v.event || old.reason !== v.reason)
        throw new HttpError(
          409,
          "Event reference already exists with different content",
        );
      return { id, eventId: old.id, replayed: true };
    }
    if (v.source !== "TEST") {
      const transitions: Record<string, string[]> = {
        PREPARING: ["DISPATCHED", "EXCEPTION", "LOST", "RETURNED"],
        DISPATCHED: ["IN_TRANSIT", "SIGNED", "EXCEPTION", "LOST", "RETURNED"],
        IN_TRANSIT: ["SIGNED", "EXCEPTION", "LOST", "RETURNED"],
        EXCEPTION: ["IN_TRANSIT", "SIGNED", "LOST", "RETURNED"],
        SIGNED: ["EXCEPTION", "RETURNED"],
        LOST: ["EXCEPTION"],
        RETURNED: [],
      };
      if (
        !["NOTE", "ETA_CHANGED"].includes(v.event) &&
        !transitions[p.transportStatus]?.includes(v.event)
      )
        throw new HttpError(
          409,
          "Transport event does not follow the current state; record a note or an authorized exception first",
        );
      if (
        p.dispatchedAt &&
        new Date(v.occurredAt) < p.dispatchedAt &&
        v.event !== "NOTE"
      )
        throw new HttpError(400, "Event precedes recorded dispatch");
    }
    const states: Record<string, string> = {
      DISPATCHED: "DISPATCHED",
      IN_TRANSIT: "IN_TRANSIT",
      SIGNED: "SIGNED",
      EXCEPTION: "EXCEPTION",
      LOST: "LOST",
      RETURNED: "RETURNED",
    };
    const data =
      v.source === "TEST"
        ? {}
        : v.event === "ETA_CHANGED"
          ? { etaStart: date(v.etaStart), etaEnd: date(v.etaEnd) }
          : v.event === "NOTE"
            ? {}
            : {
                transportStatus: states[v.event],
                ...(v.event === "DISPATCHED"
                  ? { dispatchedAt: new Date(v.occurredAt) }
                  : {}),
                ...(v.event === "SIGNED"
                  ? { signedAt: new Date(v.occurredAt) }
                  : {}),
                ...(["EXCEPTION", "LOST"].includes(v.event)
                  ? { exception: v.reason }
                  : { exception: "" }),
              };
    const after = await tx.parcel.update({ where: { id }, data });
    const e = await tx.parcelEvent.create({
      data: {
        parcelId: id,
        reference: v.reference,
        event: v.event,
        occurredAt: new Date(v.occurredAt),
        actorId: actor.id,
        source: v.source,
        reason: v.reason,
        before: plain(p),
        after: plain(after),
      },
    });
    await audit(tx, actor, "PARCEL_" + v.event, "parcel", id, v.reason, p, {
      ...after,
      source: v.source,
      occurredAt: v.occurredAt,
    });
    return { id, eventId: e.id };
  });
}
export async function logisticsList(actor: Actor) {
  staff(actor);
  const db = database();
  const [parcels, transfers, orders, returns] = await Promise.all([
    db.parcel.findMany({
      include: {
        lines: { include: { purchaseLine: true } },
        receipts: { include: { lines: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.transfer.findMany({
      include: { lines: true, receipts: { select: { createdAt: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.shopOrder.findMany({
      where: { shippedAt: { not: null } },
      include: { lines: true },
      orderBy: { shippedAt: "desc" },
    }),
    db.orderReturn.findMany({
      include: { order: true, line: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const rows: Record<string, unknown>[] = [];
  for (const p of parcels) {
    try {
      await parcelPermission(actor, p);
    } catch {
      continue;
    }
    const received = p.receipts
        .flatMap((r) => r.lines)
        .reduce((n, l) => n + l.sellable + l.unavailable, 0),
      total = p.lines.reduce((n, l) => n + l.quantity, 0);
    rows.push({
      ...p,
      lines: p.lines.map((l) => ({
        id: l.id,
        variantId: l.variantId,
        quantity: l.quantity,
        purchaseLineId: l.purchaseLineId,
        sku: l.purchaseLine?.snapshot,
      })),
      receipts: undefined,
      receivedAt:
        p.receipts
          .map((r) => r.occurredAt)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
      received,
      total,
      acceptanceStatus:
        p.type === "SUPPLIER_INBOUND"
          ? received === 0
            ? "NOT_RECEIVED"
            : received < total
              ? "PART_RECEIVED"
              : "RECEIVED"
          : "SEE_LINKED_RECORD",
      source: "PARCEL",
      reference: p.purchaseId ?? p.transferId ?? p.orderId ?? p.returnId,
    });
  }
  for (const t of transfers) {
    rows.push({
      id: "transfer:" + t.id,
      number: t.number,
      type: "TRANSFER",
      source: "TRANSFER",
      reference: t.id,
      sourcePlace: "BEIJING",
      destinationPlace: "MELBOURNE",
      warehouse: "MELBOURNE",
      timezone: "Australia/Melbourne",
      carrier: t.carrier,
      trackingNumber: t.trackingNumber,
      transportStatus: t.status,
      acceptanceStatus:
        t.status === "CLOSED"
          ? "ACCOUNTED_FOR"
          : t.status === "PARTIAL"
            ? "PART_RECEIVED"
            : "NOT_RECEIVED",
      dispatchedAt: t.dispatchedAt,
      etaStart: t.etaStart,
      etaEnd: t.etaEnd,
      createdAt: t.createdAt,
      receivedAt:
        t.receipts
          .map((r) => r.createdAt)
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
      exception: t.exception ? "Recorded transfer exception" : "",
      lines: t.lines.map((l) => ({ variantId: l.variantId, quantity: l.sent })),
      received: t.lines.reduce(
        (n, l) => n + l.receivedSellable + l.receivedUnavailable,
        0,
      ),
      total: t.lines.reduce((n, l) => n + l.sent, 0),
      assigneeId: t.createdBy,
    });
  }
  for (const o of orders)
    rows.push({
      id: "order:" + o.id,
      number: o.number,
      type: "CUSTOMER_DELIVERY",
      source: "ORDER",
      reference: o.id,
      sourcePlace: "MELBOURNE",
      destinationPlace: "Customer",
      warehouse: null,
      timezone: "Australia/Melbourne",
      carrier: o.carrier,
      trackingNumber: o.trackingNumber,
      transportStatus: "DISPATCHED",
      acceptanceStatus: "CUSTOMER_DELIVERY_NOT_WAREHOUSE_RECEIPT",
      dispatchedAt: o.shippedAt,
      createdAt: o.createdAt,
      exception: o.exception,
      lines: o.lines.map((l) => ({
        variantId: l.variantId,
        quantity: l.quantity,
      })),
      total: o.lines.reduce((n, l) => n + l.quantity, 0),
    });
  for (const r of returns)
    rows.push({
      id: "return:" + r.id,
      number: "Return " + r.id.slice(-8),
      type: "CUSTOMER_RETURN",
      source: "RETURN",
      reference: r.orderId,
      sourcePlace: "Customer",
      destinationPlace: "MELBOURNE",
      warehouse: "MELBOURNE",
      timezone: "Australia/Melbourne",
      transportStatus: "MANUALLY_RECEIVED",
      acceptanceStatus: "RECEIVED",
      createdAt: r.createdAt,
      receivedAt: r.createdAt,
      lines: [
        { variantId: r.line.variantId, quantity: r.sellable + r.unavailable },
      ],
      total: r.sellable + r.unavailable,
    });
  const purchaseNumbers = new Map(
    (await db.purchase.findMany({ select: { id: true, number: true } })).map(
      (p) => [p.id, p.number],
    ),
  );
  const transferNumbers = new Map(transfers.map((t) => [t.id, t.number])),
    orderNumbers = new Map(orders.map((o) => [o.id, o.number]));
  for (const row of rows) {
    row.businessNumber =
      purchaseNumbers.get(String(row.reference)) ??
      transferNumbers.get(String(row.reference)) ??
      orderNumbers.get(String(row.reference)) ??
      row.number;
    row.sourceWarehouse =
      row.type === "TRANSFER"
        ? "BEIJING"
        : row.type === "CUSTOMER_DELIVERY"
          ? "MELBOURNE"
          : row.type === "SUPPLIER_RETURN"
            ? row.warehouse
            : null;
  }
  return rows;
}
export async function parcelDetail(actor: Actor, id: string) {
  const db = database();
  const p = await db.parcel.findUniqueOrThrow({
    where: { id },
    include: {
      lines: true,
      events: { orderBy: { createdAt: "asc" } },
      receipts: { include: { lines: true } },
    },
  });
  await parcelPermission(actor, p);
  const financial = await allowed(actor, "finance");
  const fees = financial
    ? await db.expenseLink.findMany({
        where: { objectType: "parcel", objectId: id },
        include: {
          expense: {
            select: { id: true, number: true, currency: true, amount: true },
          },
        },
      })
    : [];
  const notifications = await db.notification.findMany({
    where: {
      OR: [
        { objectType: "parcel", objectId: id },
        ...(p.purchaseId
          ? [{ objectType: "purchase", objectId: p.purchaseId }]
          : []),
      ],
    },
    select: {
      id: true,
      title: true,
      status: true,
      pinned: true,
      type: true,
      warehouse: true,
      recipientIds: true,
    },
  });
  return {
    ...p,
    fees,
    notifications: notifications
      .filter((n) => canView(actor, n))
      .map(({ id, title, status, pinned }) => ({ id, title, status, pinned })),
    history: await db.auditLog.findMany({
      where: { objectType: "parcel", objectId: id },
      orderBy: { createdAt: "asc" },
    }),
    receiving:
      p.purchaseId && p.type === "SUPPLIER_INBOUND"
        ? {
            purchaseId: p.purchaseId,
            parcelId: p.id,
            sharedEndpoint:
              "/api/business/purchases/" + p.purchaseId + "/receive",
          }
        : null,
    inventoryNote:
      "Transport events never change stock. Use linked purchase receiving, transfer receiving or order fulfilment.",
    remaining: p.purchaseId
      ? await db.purchaseLine
          .findMany({
            where: { purchaseId: p.purchaseId },
            select: {
              id: true,
              quantity: true,
              replacementQty: true,
              receivedSellable: true,
              receivedUnavailable: true,
              cancelledQty: true,
              shortClosedQty: true,
            },
          })
          .then((a) =>
            a.map((l) => ({ id: l.id, remaining: remainingPurchase(l) })),
          )
      : [],
  };
}
