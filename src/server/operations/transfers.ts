import "server-only";
import { randomUUID } from "node:crypto";
import { database } from "../db";
import { HttpError } from "../errors";
import { z } from "zod";
import {
  command,
  lock,
  owner,
  staff,
  audit,
  type Actor,
  type Tx,
} from "./core";
import {
  transferSchema,
  receiptSchema,
  key,
  reason,
  quantity,
  ident,
} from "./validation";
import { balance, available, changeBalance } from "./inventory";
import { withActorNames } from "./annotations";
export const remaining = (l: {
  sent: number;
  receivedSellable: number;
  receivedUnavailable: number;
  lost: number;
  returned?: number;
}) =>
  l.sent -
  l.receivedSellable -
  l.receivedUnavailable -
  l.lost -
  (l.returned ?? 0);
export async function createTransfer(actor: Actor, input: unknown) {
  owner(actor);
  const v = transferSchema.parse(input);
  return command(actor, "transfer-create", v.key, v, async (tx) => {
    const transfer = await tx.transfer.create({
      data: {
        number: `TR-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
        createdBy: actor.id,
        carrier: v.carrier,
        trackingNumber: v.trackingNumber,
        etaStart: v.etaStart,
        etaEnd: v.etaEnd,
        notes: v.notes,
        lines: { create: v.lines },
      },
    });
    await audit(
      tx,
      actor,
      "TRANSFER_DRAFT",
      "transfer",
      transfer.id,
      "Draft created",
      undefined,
      v,
    );
    return { id: transfer.id, number: transfer.number };
  });
}
async function lockedTransfer(tx: Tx, id: string) {
  await lock(tx, `transfer:${id}`);
  const t = await tx.transfer.findUnique({
    where: { id },
    include: { lines: { orderBy: { variantId: "asc" } } },
  });
  if (!t) throw new HttpError(404, "Transfer not found.");
  return t;
}
const dispatchSchema = z.object({
  key,
  reason,
  dispatchedAt: z.string().datetime({ offset: true }),
  lines: z
    .array(z.object({ lineId: ident, quantity }))
    .min(1)
    .max(100),
});
export async function dispatchTransfer(
  actor: Actor,
  id: string,
  input: unknown,
) {
  owner(actor);
  const v = dispatchSchema.parse(input);
  if (new Date(v.dispatchedAt).getTime() > Date.now() + 60000)
    throw new HttpError(400, "Actual dispatch date cannot be in the future.");
  return command(
    actor,
    "transfer-dispatch",
    v.key,
    { id, ...v },
    async (tx) => {
      const t = await lockedTransfer(tx, id);
      if (t.status !== "DRAFT")
        throw new HttpError(
          409,
          "Only a draft can be dispatched. A sent transfer cannot be cancelled to restore stock.",
        );
      if (
        v.lines.length !== t.lines.length ||
        new Set(v.lines.map((l) => l.lineId)).size !== v.lines.length ||
        !v.lines.some((l) => l.quantity > 0)
      )
        throw new HttpError(
          400,
          "Enter actual dispatched quantities for every line.",
        );
      for (const line of t.lines) {
        const n = v.lines.find((l) => l.lineId === line.id)?.quantity;
        if (n === undefined || n > line.planned)
          throw new HttpError(
            400,
            "Dispatched quantity exceeds its planned line.",
          );
        if (n) {
          const b = await balance(tx, line.variantId, t.source);
          if (available(b) < n)
            throw new HttpError(
              409,
              "Beijing available stock changed. Refresh quantities.",
            );
          await changeBalance(
            tx,
            actor,
            line.variantId,
            t.source,
            { onHand: -n, inTransit: n },
            "TRANSFER_SENT",
            "transfer",
            id,
            v.reason,
          );
        }
        await tx.transferLine.update({
          where: { id: line.id },
          data: { sent: n },
        });
      }
      await tx.transfer.update({
        where: { id },
        data: { status: "SENT", dispatchedAt: new Date(v.dispatchedAt) },
      });
      await audit(
        tx,
        actor,
        "TRANSFER_SENT",
        "transfer",
        id,
        v.reason,
        { status: t.status },
        v,
      );
      return { id };
    },
  );
}
export async function receiveTransfer(
  actor: Actor,
  id: string,
  input: unknown,
) {
  staff(actor, true);
  const v = receiptSchema.parse(input);
  if (actor.role !== "admin" && v.lines.some((l) => l.lost > 0))
    throw new HttpError(403, "Only the owner can confirm transit loss.");
  return command(actor, "transfer-receive", v.key, { id, ...v }, async (tx) => {
    const t = await lockedTransfer(tx, id);
    if (!["SENT", "PARTIAL"].includes(t.status))
      throw new HttpError(409, "This transfer is not awaiting receipt.");
    if (actor.role === "warehouse" && t.destination !== "MELBOURNE")
      throw new HttpError(403, "Only Melbourne receipts are authorized.");
    const ids = [...new Set(v.attachmentMediaIds)];
    if ((await tx.media.count({ where: { id: { in: ids } } })) !== ids.length)
      throw new HttpError(400, "An attachment no longer exists.");
    const receipt = await tx.transferReceipt.create({
      data: {
        transferId: id,
        actorId: actor.id,
        reason: v.reason,
        notes: v.notes,
        attachments: { create: ids.map((mediaId) => ({ mediaId })) },
      },
    });
    for (const line of [...v.lines].sort((a, b) => {
      const x = t.lines.find((l) => l.id === a.lineId)?.variantId ?? "",
        y = t.lines.find((l) => l.id === b.lineId)?.variantId ?? "";
      return x.localeCompare(y);
    })) {
      const original = t.lines.find((l) => l.id === line.lineId);
      const total = line.sellable + line.unavailable + line.lost;
      if (!original || total > remaining(original))
        throw new HttpError(
          409,
          "Receipt exceeds the remaining dispatched quantity.",
        );
      if (!total) continue;
      await tx.transferReceiptLine.create({
        data: {
          receiptId: receipt.id,
          transferLineId: line.lineId,
          sellable: line.sellable,
          unavailable: line.unavailable,
          lost: line.lost,
        },
      });
      await tx.transferLine.update({
        where: { id: line.lineId },
        data: {
          receivedSellable: { increment: line.sellable },
          receivedUnavailable: { increment: line.unavailable },
          lost: { increment: line.lost },
        },
      });
      await changeBalance(
        tx,
        actor,
        original.variantId,
        t.destination,
        {
          onHand: line.sellable + line.unavailable,
          unavailable: line.unavailable,
          inTransit: -total,
        },
        line.lost ? "RECEIPT_AND_TRANSIT_LOSS" : "TRANSFER_RECEIVED",
        "receipt",
        receipt.id,
        v.reason,
      );
    }
    const lines = await tx.transferLine.findMany({ where: { transferId: id } });
    const status = lines.every((l) => remaining(l) === 0)
      ? "CLOSED"
      : "PARTIAL";
    await tx.transfer.update({ where: { id }, data: { status } });
    await audit(
      tx,
      actor,
      "TRANSFER_RECEIPT",
      "transfer",
      id,
      v.reason,
      undefined,
      {
        receiptId: receipt.id,
        lines: v.lines,
        status,
        remaining: lines.reduce((sum, line) => sum + remaining(line), 0),
      },
    );
    return { id, receiptId: receipt.id, status };
  });
}
const updateSchema = z
  .object({
    key,
    reason,
    carrier: z.string().max(120),
    trackingNumber: z.string().max(200),
    etaStart: z.string().datetime({ offset: true }).nullable(),
    etaEnd: z.string().datetime({ offset: true }).nullable(),
    exception: z.boolean(),
    showRestocking: z.boolean(),
    notes: z.string().max(2000),
  })
  .refine(
    (v) => !v.etaStart || !v.etaEnd || v.etaStart <= v.etaEnd,
    "ETA end must not precede start.",
  );
export async function updateTransfer(actor: Actor, id: string, input: unknown) {
  owner(actor);
  const v = updateSchema.parse(input);
  return command(actor, "transfer-update", v.key, { id, ...v }, async (tx) => {
    const t = await lockedTransfer(tx, id);
    if (["CANCELLED", "CLOSED"].includes(t.status))
      throw new HttpError(409, "This transfer is closed.");
    const { key: _key, reason, ...data } = v;
    void _key;
    await tx.transfer.update({ where: { id }, data });
    await audit(
      tx,
      actor,
      "TRANSFER_UPDATED",
      "transfer",
      id,
      reason,
      {
        etaStart: t.etaStart,
        etaEnd: t.etaEnd,
        carrier: t.carrier,
        trackingNumber: t.trackingNumber,
        exception: t.exception,
        showRestocking: t.showRestocking,
      },
      data,
    );
    return { id };
  });
}
export async function cancelTransfer(
  actor: Actor,
  id: string,
  key: string,
  reason: string,
) {
  owner(actor);
  return command(actor, "transfer-cancel", key, { id, reason }, async (tx) => {
    const t = await lockedTransfer(tx, id);
    if (t.status !== "DRAFT")
      throw new HttpError(
        409,
        "Only an unsent draft can be cancelled. Record a receipt, confirmed loss, or a real stock correction for sent goods.",
      );
    await tx.transfer.update({ where: { id }, data: { status: "CANCELLED" } });
    await audit(tx, actor, "TRANSFER_CANCELLED", "transfer", id, reason);
    return { id };
  });
}
export async function transferDetails(actor: Actor, id: string) {
  staff(actor);
  const t = await database().transfer.findUnique({
    where: { id },
    include: {
      lines: {
        include: {
          variant: {
            select: {
              sku: true,
              size: true,
              color: true,
              product: { select: { name: true } },
            },
          },
        },
      },
      receipts: {
        include: { lines: true, attachments: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!t) throw new HttpError(404, "Transfer not found.");
  const history = await database().auditLog.findMany({
    where: { objectType: "transfer", objectId: id },
    orderBy: { createdAt: "asc" },
  });
  return {
    ...t,
    lines: t.lines.map((l) => ({ ...l, remaining: remaining(l) })),
    history: await withActorNames(history),
    receipts: await withActorNames(t.receipts),
  };
}

export async function returnTransfer(actor: Actor, id: string, input: unknown) {
  owner(actor);
  const v = z
    .object({
      key,
      reason,
      lines: z
        .array(z.object({ lineId: ident, quantity: quantity.min(1) }))
        .min(1)
        .max(100),
    })
    .strict()
    .parse(input);
  if (new Set(v.lines.map((l) => l.lineId)).size !== v.lines.length)
    throw new HttpError(400, "Duplicate transfer line.");
  return command(actor, "transfer-return", v.key, { id, ...v }, async (tx) => {
    const t = await lockedTransfer(tx, id);
    if (!["SENT", "PARTIAL"].includes(t.status))
      throw new HttpError(
        409,
        "Only goods still in transit can be returned to Beijing.",
      );
    const receipt = await tx.transferReceipt.create({
      data: {
        transferId: id,
        actorId: actor.id,
        reason: v.reason,
        kind: "SOURCE_RETURN",
      },
    });
    const lines = [...v.lines].sort((a, b) =>
      (t.lines.find((l) => l.id === a.lineId)?.variantId ?? "").localeCompare(
        t.lines.find((l) => l.id === b.lineId)?.variantId ?? "",
      ),
    );
    for (const line of lines) {
      const old = t.lines.find((l) => l.id === line.lineId);
      if (!old || line.quantity > remaining(old))
        throw new HttpError(
          409,
          "Source return exceeds the quantity still in transit.",
        );
      await tx.transferLine.update({
        where: { id: old.id },
        data: { returned: { increment: line.quantity } },
      });
      await tx.transferReceiptLine.create({
        data: {
          receiptId: receipt.id,
          transferLineId: old.id,
          sellable: 0,
          unavailable: 0,
          lost: 0,
          returned: line.quantity,
        },
      });
      await changeBalance(
        tx,
        actor,
        old.variantId,
        t.source,
        {
          onHand: line.quantity,
          unavailable: line.quantity,
          inTransit: -line.quantity,
        },
        "TRANSFER_RETURNED",
        "receipt",
        receipt.id,
        v.reason,
      );
    }
    const updated = await tx.transferLine.findMany({
      where: { transferId: id },
    });
    const status = updated.every((l) => remaining(l) === 0)
      ? "CLOSED"
      : "PARTIAL";
    await tx.transfer.update({ where: { id }, data: { status } });
    await audit(
      tx,
      actor,
      "TRANSFER_RETURNED",
      "transfer",
      id,
      v.reason,
      undefined,
      { lines: v.lines, status },
    );
    return { id, receiptId: receipt.id };
  });
}
