import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { database } from "../db";
import { HttpError } from "../errors";
import { changeBalance, balance, available } from "../operations/inventory";
import { staff, warehouseAccess } from "../operations/core";
import {
  permit,
  command,
  audit,
  lock,
  assignee,
  base,
  currencies,
  qty,
  money,
  ident,
  text,
  url,
  day,
  occurred,
  date,
  plain,
  safeAmount,
  version,
  cashTotals,
  type Actor,
  type Tx,
} from "./common";
export const remainingPurchase = (l: {
  quantity: number;
  replacementQty: number;
  receivedSellable: number;
  receivedUnavailable: number;
  cancelledQty: number;
  shortClosedQty: number;
}) =>
  l.quantity +
  l.replacementQty -
  l.receivedSellable -
  l.receivedUnavailable -
  l.cancelledQty -
  l.shortClosedQty;
export async function saveSupplier(actor: Actor, input: unknown) {
  await permit(actor, "procurement");
  const v = z
    .object({
      ...base,
      id: ident.optional(),
      code: z.string().trim().min(1).max(80),
      name: z.string().trim().min(1).max(200),
      contact: text,
      contactDetails: text,
      website: url,
      currency: currencies,
      notes: text,
      archived: z.boolean().default(false),
    })
    .strict()
    .parse(input);
  return command(actor, "supplier", v.key, v, async (tx) => {
    const { key, reason, id, ...data } = v;
    void key;
    const before = id
      ? await tx.supplier.findUniqueOrThrow({ where: { id } })
      : null;
    const saved = id
      ? await tx.supplier.update({ where: { id }, data })
      : await tx.supplier.create({ data });
    await audit(
      tx,
      actor,
      "SUPPLIER_SAVED",
      "supplier",
      saved.id,
      reason,
      before,
      saved,
    );
    return { id: saved.id };
  });
}
export async function saveSource(actor: Actor, input: unknown) {
  await permit(actor, "procurement");
  const v = z
    .object({
      ...base,
      supplierId: ident,
      variantId: ident,
      supplierCode: z.string().trim().min(1).max(120),
      url,
      notes: text,
    })
    .strict()
    .parse(input);
  return command(actor, "supplier-source", v.key, v, async (tx) => {
    const { key, reason, ...data } = v;
    void key;
    const where = {
      supplierId_variantId_supplierCode: {
        supplierId: v.supplierId,
        variantId: v.variantId,
        supplierCode: v.supplierCode,
      },
    };
    const before = await tx.supplierSku.findUnique({ where });
    const s = await tx.supplierSku.upsert({
      where,
      create: data,
      update: { url: v.url, notes: v.notes },
    });
    await audit(
      tx,
      actor,
      "SUPPLIER_SOURCE",
      "supplier",
      v.supplierId,
      reason,
      before,
      s,
    );
    return { id: s.id };
  });
}
const lineSchema = z.object({
  variantId: ident,
  supplierCode: text,
  quantity: qty.min(1),
  unitCost: money,
});
const purchaseSchema = z
  .object({
    ...base,
    id: ident.optional(),
    version: z.number().int().positive().optional(),
    supplierId: ident,
    assigneeId: ident,
    warehouse: z.enum(["BEIJING", "MELBOURNE"]),
    orderedAt: occurred,
    etaStart: day.nullable(),
    etaEnd: day.nullable(),
    currency: currencies,
    discount: money,
    domesticShipping: money,
    otherFees: money,
    notes: text,
    lines: z.array(lineSchema).min(1).max(100),
    acknowledgePayments: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) => !v.etaStart || !v.etaEnd || v.etaStart <= v.etaEnd,
    "ETA end must be after start",
  )
  .refine(
    (v) => new Set(v.lines.map((l) => l.variantId)).size === v.lines.length,
    "Duplicate SKU",
  );
async function locked(tx: Tx, id: string) {
  await lock(tx, `purchase:${id}`);
  const expense = await tx.expense.findUnique({
    where: { purchaseId: id },
    select: { id: true },
  });
  if (expense) await lock(tx, "expense:" + expense.id);
  return tx.purchase.findUniqueOrThrow({
    where: { id },
    include: {
      lines: { orderBy: { variantId: "asc" } },
      expense: { include: { cash: true } },
    },
  });
}
async function syncExpense(
  tx: Tx,
  p: Awaited<ReturnType<typeof locked>>,
  actor: Actor,
  ack: boolean,
) {
  if (!p.expense) return;
  if (p.expense.cash.length && !ack)
    throw new HttpError(
      409,
      "Payments already exist. Explicitly acknowledge the payment history before revising this purchase.",
    );
  await tx.expense.update({
    where: { id: p.expense.id },
    data: {
      amount: p.total,
      dueAt: p.etaEnd ?? new Date(p.orderedAt.toISOString().slice(0, 10)),
      resultDueAt: p.etaEnd ?? new Date(p.orderedAt.toISOString().slice(0, 10)),
      reportAmount: p.currency === "AUD" ? p.total : null,
      rateMicros: null,
      rateDate: null,
      rateSource: "",
      version: { increment: 1 },
    },
  });
  void actor;
}
export async function savePurchase(actor: Actor, input: unknown) {
  await permit(actor, "procurement");
  const v = purchaseSchema.parse(input);
  return command(actor, "purchase-save", v.key, v, async (tx) => {
    const old = v.id ? await locked(tx, v.id) : null;
    if (old) {
      version(old.version, v.version ?? 0);
      if (["CLOSED", "CANCELLED"].includes(old.status))
        throw new HttpError(409, "Closed purchase cannot be edited.");
      if (
        v.supplierId !== old.supplierId ||
        v.currency !== old.currency ||
        v.warehouse !== old.warehouse
      )
        throw new HttpError(
          409,
          "Supplier, currency and receiving warehouse are fixed; create a separate purchase.",
        );
      if (
        old.lines.some((l) => !v.lines.some((i) => i.variantId === l.variantId))
      )
        throw new HttpError(
          400,
          "Keep existing lines; use Cancel remaining with a recorded reason.",
        );
    }
    await assignee(tx, v.assigneeId);
    const supplier = await tx.supplier.findFirst({
      where: { id: v.supplierId, archived: false },
    });
    if (!supplier) throw new HttpError(400, "Choose an active supplier");
    const snapshots = [];
    let subtotal = 0;
    for (const l of v.lines) {
      const sku = await tx.productVariant.findUnique({
        where: { id: l.variantId },
        include: { product: true },
      });
      if (!sku) throw new HttpError(400, "SKU not found");
      const before = old?.lines.find((x) => x.variantId === l.variantId);
      if (
        before &&
        l.quantity + before.replacementQty <
          before.receivedSellable +
            before.receivedUnavailable +
            before.cancelledQty +
            before.shortClosedQty
      )
        throw new HttpError(
          409,
          "Quantity cannot fall below fulfilled or explicitly closed quantities",
        );
      if (before && l.quantity < before.quantity) {
        const allocations = await tx.parcelLine.aggregate({
          where: {
            purchaseLineId: before.id,
            parcel: {
              type: "SUPPLIER_INBOUND",
              transportStatus: { notIn: ["LOST", "RETURNED"] },
            },
          },
          _sum: { quantity: true },
        });
        if (
          (allocations._sum.quantity ?? 0) >
          l.quantity +
            before.replacementQty -
            before.cancelledQty -
            before.shortClosedQty
        )
          throw new HttpError(
            409,
            "Quantity revision falls below allocated parcels",
          );
      }
      subtotal += safeAmount(
        (l.quantity - (before?.cancelledQty ?? 0)) * l.unitCost,
      );
      snapshots.push({
        line: l,
        before,
        snapshot: {
          sku: sku.sku,
          name: sku.product.name,
          size: sku.size,
          color: sku.color,
        },
      });
    }
    safeAmount(subtotal);
    const total = safeAmount(
      subtotal - v.discount + v.domesticShipping + v.otherFees,
    );
    const data = {
      assigneeId: v.assigneeId,
      orderedAt: new Date(v.orderedAt),
      etaStart: date(v.etaStart),
      etaEnd: date(v.etaEnd),
      discount: v.discount,
      domesticShipping: v.domesticShipping,
      otherFees: v.otherFees,
      subtotal,
      total,
      notes: v.notes,
    };
    const p = old
      ? await tx.purchase.update({
          where: { id: old.id },
          data: { ...data, version: { increment: 1 } },
        })
      : await tx.purchase.create({
          data: {
            ...data,
            number: "PO-" + randomUUID().slice(0, 12).toUpperCase(),
            supplierId: supplier.id,
            supplierSnapshot: plain(supplier),
            createdBy: actor.id,
            warehouse: v.warehouse,
            currency: v.currency,
          },
        });
    for (const x of snapshots) {
      if (x.before)
        await tx.purchaseLine.update({
          where: { id: x.before.id },
          data: x.line,
        });
      else
        await tx.purchaseLine.create({
          data: { ...x.line, purchaseId: p.id, snapshot: x.snapshot },
        });
    }
    const after = await locked(tx, p.id);
    await syncExpense(tx, after, actor, v.acknowledgePayments);
    if (after.status !== "DRAFT") await completePurchase(tx, after);
    await audit(
      tx,
      actor,
      old ? "PURCHASE_REVISED" : "PURCHASE_DRAFT",
      "purchase",
      p.id,
      v.reason,
      old,
      after,
    );
    return { id: p.id };
  });
}
export async function confirmPurchase(
  actor: Actor,
  id: string,
  input: unknown,
) {
  await permit(actor, "procurement");
  const v = z
    .object({ ...base, version: z.number().int().positive() })
    .parse(input);
  return command(actor, "purchase-confirm", v.key, { id, ...v }, async (tx) => {
    const p = await locked(tx, id);
    version(p.version, v.version);
    if (p.status !== "DRAFT")
      throw new HttpError(409, "Only a draft can be confirmed");
    await tx.purchase.update({
      where: { id },
      data: { status: "CONFIRMED", version: { increment: 1 } },
    });
    const due = p.etaEnd ?? new Date(p.orderedAt.toISOString().slice(0, 10));
    const e = await tx.expense.create({
      data: {
        number: "EX-" + randomUUID().slice(0, 12).toUpperCase(),
        title: p.number + " · goods and included freight",
        categoryId: "purchase",
        purpose:
          "Purchase total, including the listed domestic shipping and other fees; not an additional freight expense.",
        payee: (p.supplierSnapshot as { name: string }).name,
        supplierId: p.supplierId,
        createdBy: actor.id,
        assigneeId: p.assigneeId,
        plannedAt: p.orderedAt,
        dueAt: due,
        currency: p.currency,
        amount: p.total,
        reportAmount: p.currency === "AUD" ? p.total : null,
        expectedResult: "Warehouse receipt accounted for",
        resultDueAt: due,
        verificationMethod: "Linked purchase receipts",
        purchaseId: id,
        timezone:
          p.warehouse === "BEIJING" ? "Asia/Shanghai" : "Australia/Melbourne",
      },
    });
    await audit(tx, actor, "PURCHASE_CONFIRMED", "purchase", id, v.reason, p, {
      expenseId: e.id,
    });
    return { id, expenseId: e.id };
  });
}
export async function receiptContext(actor: Actor, id: string) {
  staff(actor);
  const p = await database().purchase.findUniqueOrThrow({
    where: { id },
    include: { lines: true },
  });
  warehouseAccess(actor, p.warehouse);
  if (actor.role !== "admin" && actor.role !== "warehouse")
    await permit(actor, "procurement");
  return {
    id: p.id,
    number: p.number,
    warehouse: p.warehouse,
    status: p.status,
    returns: await database().supplierReturn.findMany({
      where: { purchaseId: id },
      select: { id: true, reference: true },
    }),
    lines: p.lines.map((l) => ({
      id: l.id,
      variantId: l.variantId,
      snapshot: l.snapshot,
      quantity: l.quantity,
      remaining: remainingPurchase(l),
      receivedSellable: l.receivedSellable,
      receivedUnavailable: l.receivedUnavailable,
    })),
  };
}
const actualLines = z
  .array(z.object({ lineId: ident, sellable: qty, unavailable: qty }))
  .min(1)
  .max(100)
  .refine(
    (a) =>
      new Set(a.map((l) => l.lineId)).size === a.length &&
      a.every((l) => l.sellable + l.unavailable > 0),
    "Enter unique positive receipt lines",
  );
export async function receivePurchase(
  actor: Actor,
  id: string,
  input: unknown,
) {
  const v = z
    .object({
      ...base,
      reference: z.string().trim().min(3).max(150),
      parcelId: ident.nullable().default(null),
      occurredAt: occurred,
      notes: text,
      lines: actualLines,
    })
    .strict()
    .parse(input);
  staff(actor, true);
  return command(actor, "purchase-receipt", v.key, { id, ...v }, async (tx) => {
    const p = await locked(tx, id);
    warehouseAccess(actor, p.warehouse, true);
    if (actor.role !== "warehouse") await permit(actor, "procurement", tx);
    const existing = await tx.purchaseReceipt.findUnique({
      where: {
        purchaseId_reference: { purchaseId: id, reference: v.reference },
      },
      include: { lines: true },
    });
    if (existing) {
      if (
        existing.parcelId !== v.parcelId ||
        JSON.stringify(
          existing.lines
            .map((l) => [l.lineId, l.sellable, l.unavailable])
            .sort(),
        ) !==
          JSON.stringify(
            v.lines.map((l) => [l.lineId, l.sellable, l.unavailable]).sort(),
          )
      )
        throw new HttpError(
          409,
          "This receipt reference has different quantities. Review the original receipt.",
        );
      return { id, receiptId: existing.id, replayed: true };
    }
    if (p.status !== "CONFIRMED")
      throw new HttpError(409, "Confirm the purchase before receiving");
    const parcel = v.parcelId
      ? await tx.parcel.findUnique({
          where: { id: v.parcelId },
          include: { lines: true, receipts: { include: { lines: true } } },
        })
      : null;
    if (
      v.parcelId &&
      (!parcel ||
        parcel.purchaseId !== id ||
        parcel.type !== "SUPPLIER_INBOUND")
    )
      throw new HttpError(400, "Parcel does not belong to this purchase");
    if (!parcel && !v.reason.trim())
      throw new HttpError(400, "Explain direct receipt without transport");
    const receipt = await tx.purchaseReceipt.create({
      data: {
        purchaseId: id,
        parcelId: v.parcelId,
        reference: v.reference,
        actorId: actor.id,
        occurredAt: new Date(v.occurredAt),
        reason: v.reason,
        notes: v.notes,
      },
    });
    for (const l of [...v.lines].sort((a, b) =>
      (
        p.lines.find((l) => l.id === a.lineId)?.variantId ?? a.lineId
      ).localeCompare(
        p.lines.find((l) => l.id === b.lineId)?.variantId ?? b.lineId,
      ),
    )) {
      const original = p.lines.find((x) => x.id === l.lineId);
      const total = l.sellable + l.unavailable;
      if (!original || total > remainingPurchase(original))
        throw new HttpError(
          409,
          "Receipt exceeds remaining commitment. Record an authorized purchase revision before accepting extra units.",
        );
      if (parcel) {
        const planned =
          parcel.lines.find((x) => x.purchaseLineId === l.lineId)?.quantity ??
          0;
        const received = parcel.receipts
          .flatMap((r) => r.lines)
          .filter((r) => r.lineId === l.lineId)
          .reduce((n, r) => n + r.sellable + r.unavailable, 0);
        if (total + received > planned)
          throw new HttpError(409, "Receipt exceeds this parcel allocation");
      }
      await tx.purchaseReceiptLine.create({
        data: {
          receiptId: receipt.id,
          lineId: l.lineId,
          sellable: l.sellable,
          unavailable: l.unavailable,
        },
      });
      await tx.purchaseLine.update({
        where: { id: l.lineId },
        data: {
          receivedSellable: { increment: l.sellable },
          receivedUnavailable: { increment: l.unavailable },
        },
      });
      await changeBalance(
        tx,
        actor,
        original.variantId,
        p.warehouse,
        { onHand: total, unavailable: l.unavailable },
        "PURCHASE_RECEIVED",
        "purchase-receipt",
        receipt.id,
        v.reason,
      );
    }
    const after = await locked(tx, id);
    await completePurchase(tx, after);
    await audit(
      tx,
      actor,
      "PURCHASE_RECEIVED",
      "purchase",
      id,
      v.reason,
      undefined,
      {
        receiptId: receipt.id,
        reference: v.reference,
        occurredAt: v.occurredAt,
        lines: v.lines,
      },
    );
    return { id, receiptId: receipt.id };
  });
}
async function completePurchase(tx: Tx, p: Awaited<ReturnType<typeof locked>>) {
  const done = p.lines.every((l) => remainingPurchase(l) === 0);
  await tx.purchase.update({
    where: { id: p.id },
    data: { version: { increment: 1 } },
  });
  if (p.expense)
    await tx.expense.update({
      where: { id: p.expense.id },
      data: {
        version: { increment: 1 },
        resultStatus: done ? "CONFIRMED" : "PENDING",
        resultConfirmedAt: done ? new Date() : null,
        resultEvidence: done
          ? "Linked warehouse receipts and explicitly closed differences account for the commitment."
          : "",
      },
    });
}
export async function closePurchaseLine(
  actor: Actor,
  id: string,
  input: unknown,
) {
  await permit(actor, "procurement");
  const v = z
    .object({
      ...base,
      lineId: ident,
      quantity: qty.min(1),
      kind: z.enum(["CANCEL", "SHORTAGE"]),
      acknowledgePayments: z.boolean().default(false),
    })
    .strict()
    .parse(input);
  return command(
    actor,
    "purchase-close-line",
    v.key,
    { id, ...v },
    async (tx) => {
      const p = await locked(tx, id);
      if (!["CONFIRMED", "DRAFT"].includes(p.status))
        throw new HttpError(409, "Purchase is closed");
      const l = p.lines.find((l) => l.id === v.lineId);
      if (!l || v.quantity > remainingPurchase(l))
        throw new HttpError(409, "Quantity exceeds unfulfilled commitment");
      const allocated = await tx.parcelLine.findMany({
        where: { purchaseLineId: l.id },
        include: {
          parcel: { include: { receipts: { include: { lines: true } } } },
        },
      });
      const pending = allocated
        .filter((x) => !["RETURNED", "LOST"].includes(x.parcel.transportStatus))
        .reduce(
          (n, x) =>
            n +
            Math.max(
              0,
              x.quantity -
                x.parcel.receipts
                  .flatMap((r) => r.lines)
                  .filter((r) => r.lineId === l.id)
                  .reduce((m, r) => m + r.sellable + r.unavailable, 0),
            ),
          0,
        );
      if (v.kind === "CANCEL" && remainingPurchase(l) - v.quantity < pending)
        throw new HttpError(
          409,
          "Account for already allocated parcels before cancelling these units",
        );
      await tx.purchaseLine.update({
        where: { id: l.id },
        data:
          v.kind === "CANCEL"
            ? { cancelledQty: { increment: v.quantity } }
            : { shortClosedQty: { increment: v.quantity } },
      });
      if (v.kind === "CANCEL") {
        const subtotal = safeAmount(p.subtotal - v.quantity * l.unitCost);
        const total = safeAmount(
          subtotal - p.discount + p.domesticShipping + p.otherFees,
        );
        await tx.purchase.update({ where: { id }, data: { subtotal, total } });
        await syncExpense(
          tx,
          await locked(tx, id),
          actor,
          v.acknowledgePayments,
        );
      }
      await completePurchase(tx, await locked(tx, id));
      await audit(
        tx,
        actor,
        "PURCHASE_" + v.kind,
        "purchase",
        id,
        v.reason,
        l,
        v,
      );
      return { id };
    },
  );
}
export async function returnSupplier(actor: Actor, id: string, input: unknown) {
  await permit(actor, "procurement");
  const v = z
    .object({
      ...base,
      reference: z.string().trim().min(3).max(150),
      occurredAt: occurred,
      disposition: z.enum(["REFUND", "REPLACEMENT", "NO_FURTHER_OBLIGATION"]),
      refundDueAt: day.nullable().default(null),
      lines: actualLines,
    })
    .strict()
    .parse(input);
  return command(actor, "supplier-return", v.key, { id, ...v }, async (tx) => {
    const p = await locked(tx, id);
    warehouseAccess(actor, p.warehouse, true);
    if (!["CONFIRMED", "CLOSED"].includes(p.status))
      throw new HttpError(409, "Only an executed purchase can be returned");
    if (p.status === "CLOSED" && v.disposition === "REPLACEMENT")
      await tx.purchase.update({
        where: { id },
        data: { status: "CONFIRMED" },
      });
    if (v.disposition === "REFUND" && !v.refundDueAt)
      throw new HttpError(400, "Record the agreed refund deadline");
    const r = await tx.supplierReturn.create({
      data: {
        purchaseId: id,
        reference: v.reference,
        actorId: actor.id,
        occurredAt: new Date(v.occurredAt),
        disposition: v.disposition,
        reason: v.reason,
      },
    });
    let refund = 0;
    for (const x of [...v.lines].sort((a, b) =>
      (
        p.lines.find((l) => l.id === a.lineId)?.variantId ?? a.lineId
      ).localeCompare(
        p.lines.find((l) => l.id === b.lineId)?.variantId ?? b.lineId,
      ),
    )) {
      const l = p.lines.find((l) => l.id === x.lineId);
      const total = x.sellable + x.unavailable;
      if (
        !l ||
        total > l.receivedSellable + l.receivedUnavailable - l.returnedQty
      )
        throw new HttpError(409, "Return exceeds previously accepted quantity");
      const b = await balance(tx, l.variantId, p.warehouse);
      if (x.sellable > available(b) || x.unavailable > b.unavailable)
        throw new HttpError(
          409,
          "Insufficient sellable/unavailable stock for this return",
        );
      await changeBalance(
        tx,
        actor,
        l.variantId,
        p.warehouse,
        { onHand: -total, unavailable: -x.unavailable },
        "SUPPLIER_RETURN",
        "supplier-return",
        r.id,
        v.reason,
      );
      await tx.supplierReturnLine.create({
        data: {
          returnId: r.id,
          lineId: l.id,
          sellable: x.sellable,
          unavailable: x.unavailable,
        },
      });
      await tx.purchaseLine.update({
        where: { id: l.id },
        data: {
          returnedQty: { increment: total },
          ...(v.disposition === "REPLACEMENT"
            ? { replacementQty: { increment: total } }
            : {}),
        },
      });
      refund += total * l.unitCost;
    }
    if (p.expense && v.disposition === "REFUND")
      await tx.expense.update({
        where: { id: p.expense.id },
        data: {
          expectedRefund: { increment: safeAmount(refund) },
          refundDueAt: date(v.refundDueAt),
        },
      });
    await completePurchase(tx, await locked(tx, id));
    await audit(
      tx,
      actor,
      "SUPPLIER_RETURN",
      "purchase",
      id,
      v.reason,
      undefined,
      { returnId: r.id, ...v },
    );
    return { id, returnId: r.id };
  });
}
export async function finishPurchase(actor: Actor, id: string, input: unknown) {
  await permit(actor, "procurement");
  const v = z
    .object({
      ...base,
      status: z.enum(["CLOSED", "CANCELLED"]),
      version: z.number().int().positive(),
    })
    .parse(input);
  return command(actor, "purchase-finish", v.key, { id, ...v }, async (tx) => {
    const p = await locked(tx, id);
    version(p.version, v.version);
    const cash = cashTotals(p.expense?.cash ?? []);
    if (
      v.status === "CANCELLED" &&
      (cash.paid > 0 ||
        p.lines.some((l) => l.receivedSellable + l.receivedUnavailable > 0))
    )
      throw new HttpError(
        409,
        "Executed purchases cannot be unconditionally cancelled; close the remainder and record returns/refunds separately",
      );
    if (v.status === "CLOSED" && p.lines.some((l) => remainingPurchase(l) > 0))
      throw new HttpError(
        409,
        "Account for every remaining unit before closing",
      );
    if (
      v.status === "CANCELLED" &&
      (await tx.parcel.count({ where: { purchaseId: id } }))
    )
      throw new HttpError(
        409,
        "Account for linked parcels before cancellation",
      );
    await tx.purchase.update({
      where: { id },
      data: { status: v.status, version: { increment: 1 } },
    });
    if (p.expense && v.status === "CANCELLED")
      await tx.expense.update({
        where: { id: p.expense.id },
        data: { status: "CANCELLED" },
      });
    await audit(
      tx,
      actor,
      "PURCHASE_" + v.status,
      "purchase",
      id,
      v.reason,
      p,
      { status: v.status },
    );
    return { id };
  });
}
