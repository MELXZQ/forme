import "server-only";
import { database } from "../db";
import { HttpError } from "../errors";
import {
  command,
  lock,
  owner,
  staff,
  warehouseAccess,
  audit,
  type Actor,
  type Tx,
} from "./core";
import { stockAction, adjustmentSchema } from "./validation";
import { withActorNames } from "./annotations";
import type { WarehouseCode } from "@/generated/prisma/client";
export const available = (b: {
  onHand: number;
  reserved: number;
  unavailable: number;
}) => b.onHand - b.reserved - b.unavailable;
export async function balance(
  tx: Tx,
  variantId: string,
  warehouse: WarehouseCode,
) {
  await lock(tx, `inventory:${variantId}`);
  return tx.inventoryBalance.upsert({
    where: { variantId_warehouse: { variantId, warehouse } },
    create: { variantId, warehouse },
    update: {},
  });
}
export async function changeBalance(
  tx: Tx,
  actor: Actor,
  variantId: string,
  warehouse: WarehouseCode,
  delta: {
    onHand?: number;
    reserved?: number;
    unavailable?: number;
    inTransit?: number;
  },
  kind: string,
  documentType: string,
  documentId: string,
  reason: string,
) {
  const b = await balance(tx, variantId, warehouse);
  const d = {
    onHand: delta.onHand ?? 0,
    reserved: delta.reserved ?? 0,
    unavailable: delta.unavailable ?? 0,
  };
  const next = {
    onHand: b.onHand + d.onHand,
    reserved: b.reserved + d.reserved,
    unavailable: b.unavailable + d.unavailable,
  };
  if (
    Object.values(next).some(
      (n) => !Number.isInteger(n) || n < 0 || n > 1_000_000,
    ) ||
    available(next) < 0
  )
    throw new HttpError(
      409,
      "Insufficient available inventory, or the change would exceed physical stock.",
    );
  await tx.inventoryBalance.update({ where: { id: b.id }, data: next });
  await tx.inventoryLedger.create({
    data: {
      variantId,
      warehouse,
      kind,
      deltaOnHand: d.onHand,
      deltaReserved: d.reserved,
      deltaUnavailable: d.unavailable,
      deltaInTransit: delta.inTransit ?? 0,
      beforeOnHand: b.onHand,
      beforeReserved: b.reserved,
      beforeUnavailable: b.unavailable,
      afterOnHand: next.onHand,
      afterReserved: next.reserved,
      afterUnavailable: next.unavailable,
      documentType,
      documentId,
      actorId: actor.id,
      reason,
    },
  });
  return next;
}
export async function applyStockAction(actor: Actor, input: unknown) {
  owner(actor);
  const v = stockAction.parse(input);
  const incoming = ["INITIAL", "PURCHASE", "LEGACY"].includes(v.kind);
  if (
    v.unavailableQuantity > v.quantity ||
    (!incoming && v.unavailableQuantity > 0)
  )
    throw new HttpError(
      400,
      "Unavailable received quantity must be part of an initial, purchase, or legacy receipt.",
    );
  return command(actor, "inventory", v.key, v, async (tx) => {
    const b = await balance(tx, v.variantId, v.warehouse);
    let delta: { onHand?: number; unavailable?: number } = {};
    if (v.kind === "INITIAL") {
      if (
        (await tx.legacyStock.findUnique({ where: { variantId: v.variantId } }))
          ?.remainingQty
      )
        throw new HttpError(
          409,
          "Assign the pending legacy stock first. Do not enter the same goods as new initial stock.",
        );
      if (
        await tx.inventoryLedger.count({
          where: { variantId: v.variantId, warehouse: v.warehouse },
        })
      )
        throw new HttpError(
          409,
          "Initial entry already exists. Use purchase receipt or an approved count.",
        );
      delta = { onHand: v.quantity, unavailable: v.unavailableQuantity };
    } else if (v.kind === "PURCHASE")
      delta = { onHand: v.quantity, unavailable: v.unavailableQuantity };
    else if (v.kind === "LEGACY") {
      const old = await tx.legacyStock.findUnique({
        where: { variantId: v.variantId },
      });
      if (!old || old.remainingQty < v.quantity)
        throw new HttpError(
          409,
          "This exceeds the unassigned legacy quantity.",
        );
      await tx.legacyStock.update({
        where: { variantId: v.variantId },
        data: { remainingQty: { decrement: v.quantity } },
      });
      delta = { onHand: v.quantity, unavailable: v.unavailableQuantity };
    } else if (v.kind === "DAMAGE") delta = { unavailable: v.quantity };
    else if (v.kind === "RESTORE") delta = { unavailable: -v.quantity };
    else {
      if (b.unavailable < v.quantity)
        throw new HttpError(
          409,
          "Confirmed loss can only remove previously unavailable stock. Submit a count for missing sellable stock.",
        );
      delta = { onHand: -v.quantity, unavailable: -v.quantity };
    }
    const result = await changeBalance(
      tx,
      actor,
      v.variantId,
      v.warehouse,
      delta,
      v.kind,
      "inventory",
      v.key,
      v.reason,
    );
    await audit(tx, actor, v.kind, "sku", v.variantId, v.reason, b, result);
    return result;
  });
}
export async function submitCount(actor: Actor, input: unknown) {
  const v = adjustmentSchema.parse(input);
  warehouseAccess(actor, v.warehouse, true);
  return command(actor, "count-submit", v.key, v, async (tx) => {
    const b = await balance(tx, v.variantId, v.warehouse);
    const count = await tx.stockAdjustment.create({
      data: {
        variantId: v.variantId,
        warehouse: v.warehouse,
        countedOnHand: v.countedOnHand,
        expectedOnHand: b.onHand,
        reason: v.reason,
        submittedBy: actor.id,
      },
    });
    await audit(
      tx,
      actor,
      "COUNT_SUBMITTED",
      "count",
      count.id,
      v.reason,
      { onHand: b.onHand },
      { countedOnHand: v.countedOnHand },
    );
    return { id: count.id };
  });
}

export async function resolveLegacyDiscrepancy(actor: Actor, input: unknown) {
  owner(actor);
  const v = stockAction
    .pick({ key: true, variantId: true, quantity: true, reason: true })
    .strict()
    .parse(input);
  return command(actor, "legacy-discrepancy", v.key, v, async (tx) => {
    await lock(tx, `inventory:${v.variantId}`);
    const before = await tx.legacyStock.findUnique({
      where: { variantId: v.variantId },
    });
    if (!before || before.remainingQty < v.quantity)
      throw new HttpError(
        409,
        "Discrepancy exceeds the remaining unassigned quantity.",
      );
    const after = await tx.legacyStock.update({
      where: { variantId: v.variantId },
      data: { remainingQty: { decrement: v.quantity } },
    });
    await audit(
      tx,
      actor,
      "LEGACY_DISCREPANCY",
      "sku",
      v.variantId,
      v.reason,
      { remainingQty: before.remainingQty },
      {
        remainingQty: after.remainingQty,
        confirmedNonexistent: v.quantity,
        warehouseStockChanged: false,
      },
    );
    return { variantId: v.variantId, remainingQty: after.remainingQty };
  });
}
export async function decideCount(
  actor: Actor,
  id: string,
  key: string,
  approved: boolean,
  reason: string,
) {
  owner(actor);
  return command(
    actor,
    "count-decide",
    key,
    { id, approved, reason },
    async (tx) => {
      await lock(tx, `count:${id}`);
      const c = await tx.stockAdjustment.findUnique({ where: { id } });
      if (!c) throw new HttpError(404, "Count not found.");
      if (c.status !== "PENDING")
        throw new HttpError(409, "This count has already been decided.");
      if (approved) {
        const b = await balance(tx, c.variantId, c.warehouse);
        if (b.onHand !== c.expectedOnHand)
          throw new HttpError(
            409,
            "Physical inventory changed after this count. Submit a fresh count.",
          );
        await changeBalance(
          tx,
          actor,
          c.variantId,
          c.warehouse,
          { onHand: c.countedOnHand - b.onHand },
          "COUNT_CORRECTION",
          "count",
          id,
          reason,
        );
      }
      await tx.stockAdjustment.update({
        where: { id },
        data: {
          status: approved ? "APPROVED" : "REJECTED",
          decidedBy: actor.id,
          decisionReason: reason,
          decidedAt: new Date(),
        },
      });
      await audit(
        tx,
        actor,
        approved ? "COUNT_APPROVED" : "COUNT_REJECTED",
        "count",
        id,
        reason,
      );
      return { id };
    },
  );
}
export async function skuDetails(actor: Actor, id: string) {
  staff(actor);
  const sku = await database().productVariant.findUnique({
    where: { id },
    include: {
      product: {
        include: {
          category: true,
          collections: { include: { collection: true } },
          images: { include: { media: true }, orderBy: { sortOrder: "asc" } },
        },
      },
      balances: true,
      legacyStock: true,
      inventoryPolicy: true,
    },
  });
  if (!sku) throw new HttpError(404, "SKU not found.");
  const warehouse =
    actor.role === "warehouse" ? ("MELBOURNE" as const) : undefined;
  const [ledger, transfers, counts, reservations] = await Promise.all([
    database().inventoryLedger.findMany({
      where: { variantId: id, ...(warehouse ? { warehouse } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    database().transferLine.findMany({
      where: { variantId: id },
      include: { transfer: true },
      orderBy: { transfer: { createdAt: "desc" } },
      take: 100,
    }),
    database().stockAdjustment.findMany({
      where: { variantId: id, ...(warehouse ? { warehouse } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    database().stockReservation.findMany({
      where: { variantId: id, status: "ACTIVE" },
      include: {
        order: {
          select: {
            id: true,
            number: true,
            paymentStatus: true,
            expiresAt: true,
          },
        },
      },
      take: 100,
    }),
  ]);
  return {
    sku: {
      id: sku.id,
      sku: sku.sku,
      size: sku.size,
      color: sku.color,
      name: sku.product.name,
      productStatus: sku.product.status,
      category: sku.product.category.name,
      collections: sku.product.collections.map((c) => c.collection.name),
      image: sku.product.images[0]
        ? `/media/${sku.product.images[0].mediaId}`
        : null,
      balances: sku.balances
        .filter((b) => !warehouse || b.warehouse === warehouse)
        .map((b) => ({ ...b, available: available(b) })),
      legacyRemaining:
        actor.role === "admin"
          ? (sku.legacyStock?.remainingQty ?? 0)
          : undefined,
      policy: { showRestocking: sku.inventoryPolicy?.showRestocking ?? true },
    },
    ledger: await withActorNames(ledger),
    transfers,
    counts,
    reservations,
  };
}
