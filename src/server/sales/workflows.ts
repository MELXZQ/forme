import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { HttpError } from "../errors";
import {
  base,
  ident,
  text,
  money,
  occurred,
  day,
  version,
  assignee,
  plain,
} from "../business/common";
import {
  command,
  lock,
  audit,
  owner,
  staff,
  type Actor,
} from "../operations/core";
import { balance, available, changeBalance } from "../operations/inventory";
import { accessOrder, caseAccess, compensationAccess, permit } from "./access";
const num = (prefix: string) =>
  prefix + "-" + randomUUID().slice(0, 12).toUpperCase();
const due = z.string().datetime({ offset: true });
const linesSchema = z
  .array(
    z
      .object({ variantId: ident, quantity: z.number().int().min(1).max(100) })
      .strict(),
  )
  .max(30)
  .refine(
    (v) => new Set(v.map((x) => x.variantId)).size === v.length,
    "Duplicate SKU",
  );
const lineItems = (v: unknown) => linesSchema.parse(v);
export async function saveCase(actor: Actor, input: unknown) {
  staff(actor, true);
  const v = z
    .object({
      ...base,
      id: ident.optional(),
      version: z.number().int().optional(),
      orderId: ident,
      lineId: ident.nullable().default(null),
      quantity: z.number().int().positive().nullable().default(null),
      parcelId: ident.nullable().default(null),
      type: z.enum([
        "NOT_RECEIVED",
        "DELAY",
        "DAMAGE",
        "SHORT_OR_WRONG",
        "RETURN",
        "OTHER",
      ]),
      source: z.enum(["CUSTOMER_REPORTED", "STAFF", "TEST"]),
      summary: z.string().trim().min(3).max(2000),
      assigneeId: ident,
      priority: z.number().int().min(0).max(3),
      dueAt: due,
      occurredAt: occurred,
    })
    .strict()
    .parse(input);
  return command(actor, "case-save", v.key, v, async (tx) => {
    await lock(tx, "order:" + v.orderId);
    const o = await accessOrder(actor, v.orderId, tx);
    if (
      new Date(v.occurredAt) < o.createdAt ||
      new Date(v.dueAt) < new Date(v.occurredAt)
    )
      throw new HttpError(
        400,
        "Case time must follow order creation and precede its deadline",
      );
    if (actor.role !== "admin" && v.assigneeId !== actor.id)
      await permit(actor, "aftercare", tx);
    await assignee(tx, v.assigneeId);
    if (
      v.lineId &&
      !o.lines.some(
        (l) => l.id === v.lineId && (!v.quantity || v.quantity <= l.quantity),
      )
    )
      throw new HttpError(400, "Invalid order line or quantity");
    if (v.quantity && !v.lineId)
      throw new HttpError(400, "Quantity requires an order line");
    if (
      v.parcelId &&
      !(await tx.parcel.findFirst({ where: { id: v.parcelId, orderId: o.id } }))
    )
      throw new HttpError(400, "Parcel belongs to another order");
    const old = v.id ? await caseAccess(actor, v.id, tx) : null;
    if (old) {
      if (old.orderId !== o.id)
        throw new HttpError(400, "Cannot move an existing case");
      version(old.version, v.version ?? 0);
      if (["RESOLVED", "CLOSED"].includes(old.status))
        throw new HttpError(409, "Reopen before editing");
    }
    const { id, key, reason, version: _, ...data } = v;
    void key;
    void _;
    const c = old
      ? await tx.aftercareCase.update({
          where: { id },
          data: {
            ...data,
            occurredAt: new Date(v.occurredAt),
            dueAt: new Date(v.dueAt),
            version: { increment: 1 },
          },
        })
      : await tx.aftercareCase.create({
          data: {
            ...data,
            occurredAt: new Date(v.occurredAt),
            dueAt: new Date(v.dueAt),
            number: num("AS"),
            createdBy: actor.id,
          },
        });
    await audit(
      tx,
      actor,
      old ? "AFTERCARE_REVISED" : "AFTERCARE_CREATED",
      "order",
      o.id,
      reason,
      old,
      {
        caseId: c.id,
        status: c.status,
        occurredAt: old ? new Date().toISOString() : v.occurredAt,
      },
    );
    return { id: c.id };
  });
}
export async function caseAction(actor: Actor, id: string, input: unknown) {
  staff(actor, true);
  const v = z
    .object({
      ...base,
      version: z.number().int(),
      action: z.enum([
        "RESPONSE",
        "NOTE",
        "COMMUNICATION_DRAFT",
        "COMMUNICATION_RECORDED",
        "STATUS",
        "REOPEN",
      ]),
      status: z
        .enum([
          "OPEN",
          "PROCESSING",
          "WAITING_CUSTOMER",
          "WAITING_EXTERNAL",
          "PENDING_APPROVAL",
          "PENDING_EXECUTION",
          "RESOLVED",
          "CLOSED",
        ])
        .optional(),
      content: z.string().trim().min(3).max(4000),
      occurredAt: occurred,
    })
    .strict()
    .parse(input);
  return command(actor, "case-action", v.key, { id, ...v }, async (tx) => {
    const pre = await tx.aftercareCase.findUniqueOrThrow({ where: { id } });
    await lock(tx, "order:" + pre.orderId);
    const c = await caseAccess(actor, id, tx);
    version(c.version, v.version);
    if (new Date(v.occurredAt) < c.occurredAt)
      throw new HttpError(400, "Event predates the issue");
    if (["RESOLVED", "CLOSED"].includes(c.status) && v.action !== "REOPEN")
      throw new HttpError(409, "Reopen this case first");
    if (v.action === "STATUS" && !v.status)
      throw new HttpError(400, "Choose a status");
    if (v.action === "REOPEN" && !["RESOLVED", "CLOSED"].includes(c.status))
      throw new HttpError(409, "Case is already open");
    if (
      v.status &&
      ["CLOSED", "RESOLVED"].includes(v.status) &&
      (await tx.compensation.count({
        where: {
          caseId: id,
          status: { in: ["SUBMITTED", "APPROVED", "EXECUTING", "FAILED"] },
        },
      }))
    )
      throw new HttpError(
        409,
        "Resolve active compensation requests before closing",
      );
    const status =
      v.action === "REOPEN"
        ? "OPEN"
        : v.action === "STATUS"
          ? v.status!
          : c.status;
    await tx.aftercareCase.update({
      where: { id },
      data: {
        status,
        version: { increment: 1 },
        ...(v.action === "RESPONSE" && !c.firstResponseAt
          ? { firstResponseAt: new Date(v.occurredAt) }
          : {}),
        ...(["RESOLVED", "CLOSED"].includes(status)
          ? { closedAt: new Date(v.occurredAt), outcome: v.content }
          : v.action === "REOPEN"
            ? { closedAt: null, outcome: "" }
            : {}),
      },
    });
    await audit(
      tx,
      actor,
      "AFTERCARE_" + v.action,
      "order",
      c.orderId,
      v.reason,
      { caseId: id, status: c.status },
      {
        caseId: id,
        status,
        content: v.content,
        occurredAt: v.occurredAt,
        communicationSentBySystem: false,
      },
    );
    return { id };
  });
}
export async function orderAction(actor: Actor, id: string, input: unknown) {
  staff(actor, true);
  const v = z
    .object({
      ...base,
      action: z.enum([
        "NOTE",
        "ADDRESS",
        "DELIVERED",
        "ETA",
        "ASSIGN",
        "PAYMENT",
      ]),
      content: text,
      occurredAt: occurred,
      eta: day.optional(),
      assigneeId: ident.optional(),
      reference: z.string().trim().max(200).optional(),
      evidenceId: ident.optional(),
      address: z
        .object({
          recipientName: z.string().trim().min(1).max(120),
          addressLine1: z.string().trim().min(1).max(200),
          addressLine2: text,
          city: z.string().trim().min(1).max(100),
          state: z.enum(["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"]),
          postcode: z.string().regex(/^\d{4}$/),
        })
        .strict()
        .optional(),
    })
    .strict()
    .parse(input);
  return command(
    actor,
    "sales-order-action",
    v.key,
    { id, ...v },
    async (tx) => {
      await lock(tx, "order:" + id);
      const o = await accessOrder(actor, id, tx);
      const when = new Date(v.occurredAt);
      if (when < o.createdAt)
        throw new HttpError(400, "Event predates the order");
      if (v.action === "NOTE") {
        if (v.content.length < 3)
          throw new HttpError(400, "Enter an internal note");
      }
      if (v.action === "ADDRESS") {
        owner(actor);
        if (!v.address) throw new HttpError(400, "Address required");
        await tx.shopOrder.update({ where: { id }, data: v.address });
      }
      if (v.action === "ASSIGN") {
        owner(actor);
        if (!v.assigneeId) throw new HttpError(400, "Choose an assignee");
        await assignee(tx, v.assigneeId);
        await tx.shopOrder.update({
          where: { id },
          data: { assigneeId: v.assigneeId },
        });
      }
      if (v.action === "ETA") {
        if (!v.eta) throw new HttpError(400, "ETA required");
        await tx.shopOrder.update({
          where: { id },
          data: { etaDelivery: new Date(v.eta + "T00:00:00Z") },
        });
      }
      if (v.action === "DELIVERED") {
        if (
          !o.shippedAt ||
          when < o.shippedAt ||
          o.fulfillmentStatus !== "SHIPPED" ||
          o.deliveredAt
        )
          throw new HttpError(
            409,
            "Only an undelivered shipped order may be recorded delivered",
          );
        if (v.content.length < 3)
          throw new HttpError(400, "Record delivery evidence");
        await tx.shopOrder.update({
          where: { id },
          data: { deliveredAt: when },
        });
      }
      if (v.action === "PAYMENT") {
        owner(actor);
        if (
          o.paymentStatus !== "PENDING" ||
          o.fulfillmentStatus !== "UNFULFILLED" ||
          o.expiresAt <= new Date() ||
          o.reservations.some((r) => r.status !== "ACTIVE") ||
          o.reservations.length !== o.lines.length
        )
          throw new HttpError(
            409,
            "Payment requires a valid active reservation; released orders need manual review",
          );
        if (
          !v.reference ||
          !v.evidenceId ||
          !(await tx.businessAttachment.findFirst({
            where: { id: v.evidenceId, objectType: "order", objectId: id },
          }))
        )
          throw new HttpError(
            400,
            "External payment requires an order evidence upload and reference",
          );
        if (
          await tx.orderEvent.findFirst({
            where: {
              type: "PAYMENT_SUCCEEDED",
              after: { path: ["reference"], equals: v.reference },
            },
          })
        )
          throw new HttpError(409, "Payment reference is already recorded");
        await tx.shopOrder.update({
          where: { id },
          data: { paymentStatus: "PAID", paidAt: when, dataKind: "REAL" },
        });
      }
      const addressBefore = {
        recipientName: o.recipientName,
        addressLine1: o.addressLine1,
        addressLine2: o.addressLine2,
        city: o.city,
        state: o.state,
        postcode: o.postcode,
      };
      await audit(
        tx,
        actor,
        v.action === "PAYMENT" ? "PAYMENT_CONFIRMED" : "ORDER_" + v.action,
        "order",
        id,
        v.reason,
        v.action === "ADDRESS" ? addressBefore : undefined,
        {
          ...v,
          key: undefined,
          carrierNotContacted: v.action === "ADDRESS" && !!o.shippedAt,
          source: "MANUAL",
          amountCents: v.action === "PAYMENT" ? o.totalCents : undefined,
        },
      );
      return { id };
    },
  );
}
export async function saveCompensation(actor: Actor, input: unknown) {
  staff(actor, true);
  await permit(actor, "compensationApply");
  const v = z
    .object({
      ...base,
      id: ident.optional(),
      version: z.number().int().optional(),
      caseId: ident,
      type: z.enum([
        "SHIPPING_REFUND",
        "PARTIAL_REFUND",
        "FULL_REFUND",
        "REPLACEMENT",
        "COUPON",
        "OTHER",
      ]),
      amountCents: money,
      currency: z.literal("AUD"),
      lines: linesSchema,
      basis: z.string().trim().min(3).max(3000),
      executorId: ident,
      dueAt: due,
    })
    .strict()
    .parse(input);
  return command(actor, "comp-save", v.key, v, async (tx) => {
    const c = await caseAccess(actor, v.caseId, tx);
    await lock(tx, "order:" + c.orderId);
    const o = await accessOrder(actor, c.orderId, tx);
    if (c.source === "TEST" && o.dataKind !== "TEST")
      throw new HttpError(
        400,
        "Test compensation requires a TEST order; it cannot affect a real order",
      );
    if (["RESOLVED", "CLOSED"].includes(c.status))
      throw new HttpError(
        409,
        "Reopen the case before requesting compensation",
      );
    await assignee(tx, v.executorId);
    if (
      !(await tx.user.findFirst({
        where: {
          id: v.executorId,
          active: true,
          role: { in: ["admin", "warehouse"] },
        },
      }))
    )
      throw new HttpError(
        400,
        "Executor must be an active owner or warehouse administrator",
      );
    const cash = v.type.endsWith("REFUND");
    if (cash && v.amountCents <= 0)
      throw new HttpError(400, "Refund amount must be positive");
    if (!cash && v.amountCents !== 0)
      throw new HttpError(
        400,
        "Non-refund types do not create money obligations",
      );
    if (
      v.type === "FULL_REFUND" &&
      v.amountCents !== o.totalCents - o.recordedRefundCents
    )
      throw new HttpError(400, "Full refund must equal remaining order total");
    if (v.type === "SHIPPING_REFUND" && v.amountCents > o.shippingCents)
      throw new HttpError(400, "Shipping refund exceeds shipping charged");
    if (v.type === "REPLACEMENT" && !v.lines.length)
      throw new HttpError(400, "Choose replacement quantities");
    if (v.type !== "REPLACEMENT" && v.lines.length)
      throw new HttpError(400, "Only replacement uses SKU quantities");
    if (
      v.lines.some(
        (l) =>
          !o.lines.some(
            (x) => x.variantId === l.variantId && l.quantity <= x.quantity,
          ),
      )
    )
      throw new HttpError(
        400,
        "Replacement must reference original order SKUs and quantities",
      );
    const old = v.id ? await compensationAccess(actor, v.id, tx) : null;
    if (old) {
      version(old.version, v.version ?? 0);
      if (
        old.caseId !== c.id ||
        ["COMPLETED", "EXECUTING"].includes(old.status) ||
        old.expenseId
      )
        throw new HttpError(409, "Executed compensation cannot be overwritten");
    }
    const { id, key, reason, version: _, ...raw } = v;
    void key;
    void _;
    const data = { ...raw, dueAt: new Date(v.dueAt), lines: plain(v.lines) };
    const comp = old
      ? await tx.compensation.update({
          where: { id },
          data: {
            ...data,
            status: "SUBMITTED",
            approverId: null,
            approvedAt: null,
            selfApproved: false,
            version: { increment: 1 },
          },
        })
      : await tx.compensation.create({
          data: {
            ...data,
            number: num("CO"),
            orderId: c.orderId,
            applicantId: actor.id,
          },
        });
    await audit(tx, actor, "COMPENSATION_REVISED", "order", o.id, reason, old, {
      compensationId: comp.id,
      type: v.type,
      amountCents: v.amountCents,
      status: comp.status,
    });
    return { id: comp.id };
  });
}
const heldStatuses = ["APPROVED", "EXECUTING", "FAILED"];
export async function compensationAction(
  actor: Actor,
  id: string,
  input: unknown,
) {
  staff(actor, true);
  const v = z
    .object({
      ...base,
      version: z.number().int(),
      action: z.enum([
        "SUBMIT",
        "APPROVE",
        "REJECT",
        "CANCEL",
        "FAIL",
        "REFUND",
        "RESERVE_REPLACEMENT",
        "SHIP_REPLACEMENT",
        "OTHER_COMPLETE",
      ]),
      occurredAt: occurred,
      reference: z.string().trim().max(200).default(""),
      channel: text,
      source: z.enum(["MANUAL", "TEST"]).default("MANUAL"),
      evidenceId: ident.optional(),
      carrier: text,
      trackingNumber: text,
    })
    .strict()
    .parse(input);
  if (["APPROVE", "REJECT", "REFUND"].includes(v.action)) owner(actor);
  return command(actor, "comp-action", v.key, { id, ...v }, async (tx) => {
    const pre = await tx.compensation.findUniqueOrThrow({ where: { id } });
    await lock(tx, "order:" + pre.orderId);
    const c = await compensationAccess(actor, id, tx);
    const o = await accessOrder(actor, c.orderId, tx);
    version(c.version, v.version);
    const now = new Date(v.occurredAt);
    if (now < o.createdAt) throw new HttpError(400, "Event predates order");
    let status = c.status;
    const result = v.reason;
    if (v.action === "SUBMIT") {
      await permit(actor, "compensationApply", tx);
      if (!["DRAFT", "REJECTED"].includes(c.status))
        throw new HttpError(409, "Not a draft");
      status = "SUBMITTED";
    } else if (["APPROVE", "REJECT"].includes(v.action)) {
      owner(actor);
      if (c.status !== "SUBMITTED")
        throw new HttpError(409, "Only submitted requests may be decided");
      const self = c.applicantId === actor.id;
      if (
        v.action === "APPROVE" &&
        self &&
        (await tx.user.count({ where: { role: "admin", active: true } })) > 1
      )
        throw new HttpError(
          409,
          "Another active owner must approve; self-approval only when there is one active owner",
        );
      if (v.action === "APPROVE" && c.type.endsWith("REFUND")) {
        const receipt = await tx.orderEvent.aggregate({
          where: {
            orderId: o.id,
            type: "PAYMENT_SUCCEEDED",
            dataKind: o.dataKind,
          },
          _sum: { amountCents: true },
        });
        const held = await tx.compensation.aggregate({
          where: {
            orderId: o.id,
            status: { in: heldStatuses },
            id: { not: id },
          },
          _sum: { amountCents: true },
        });
        if (
          o.paymentStatus !== "PAID" ||
          o.dataKind === "UNKNOWN" ||
          c.amountCents + (held._sum.amountCents ?? 0) + o.recordedRefundCents >
            (receipt._sum.amountCents ?? 0)
        )
          throw new HttpError(
            409,
            "Refund exceeds verified receipts after completed refunds and approved reservations",
          );
        if (c.type === "SHIPPING_REFUND") {
          const prior = await tx.compensation.aggregate({
            where: {
              orderId: o.id,
              type: c.type,
              status: { in: [...heldStatuses, "COMPLETED"] },
              id: { not: id },
            },
            _sum: { amountCents: true },
          });
          if (c.amountCents + (prior._sum.amountCents ?? 0) > o.shippingCents)
            throw new HttpError(409, "Shipping allowance already committed");
        }
      }
      status = v.action === "APPROVE" ? "APPROVED" : "REJECTED";
      await tx.compensation.update({
        where: { id },
        data: {
          approverId: actor.id,
          approvalNote: v.reason,
          selfApproved: self,
          approvedAt: v.action === "APPROVE" ? now : null,
        },
      });
    } else if (v.action === "CANCEL") {
      if (
        actor.role !== "admin" &&
        (actor.id !== c.applicantId ||
          !["DRAFT", "SUBMITTED"].includes(c.status))
      )
        throw new HttpError(
          403,
          "Owner required to cancel an approved request",
        );
      if (c.status === "COMPLETED")
        throw new HttpError(409, "Completed execution cannot be cancelled");
      const r = await tx.replacementShipment.findUnique({
        where: { compensationId: id },
      });
      if (r?.status === "SHIPPED") throw new HttpError(409, "Already shipped");
      if (r?.status === "RESERVED") {
        for (const l of lineItems(r.lines).sort((a, b) =>
          a.variantId.localeCompare(b.variantId),
        ))
          await changeBalance(
            tx,
            actor,
            l.variantId,
            "MELBOURNE",
            { reserved: -l.quantity },
            "REPLACEMENT_RELEASED",
            "replacement",
            r.id,
            v.reason,
          );
        await tx.replacementShipment.update({
          where: { id: r.id },
          data: { status: "CANCELLED", cancelledAt: now },
        });
      }
      status = "CANCELLED";
    } else {
      if (v.action === "SHIP_REPLACEMENT") {
        if (actor.role !== "admin" && actor.id !== c.executorId)
          await permit(actor, "compensationExecute", tx);
      } else if (v.action === "REFUND") owner(actor);
      else await permit(actor, "compensationExecute", tx);
      if (!heldStatuses.includes(c.status))
        throw new HttpError(
          409,
          "An approved, uncompleted request is required",
        );
      if (v.action === "FAIL") {
        status = "FAILED";
      }
      if (v.action === "REFUND") {
        if (!c.type.endsWith("REFUND"))
          throw new HttpError(400, "This is not a monetary refund");
        if (
          v.source === "TEST" &&
          (process.env.NODE_ENV === "production" ||
            process.env.ENABLE_DEV_PAYMENTS !== "true" ||
            o.dataKind !== "TEST")
        )
          throw new HttpError(
            403,
            "Simulation is restricted to enabled development test orders",
          );
        if (v.source === "MANUAL" && o.dataKind !== "REAL")
          throw new HttpError(
            409,
            "Cannot record a real refund against a test or unverified payment",
          );
        if (
          !v.reference ||
          !v.channel ||
          !v.evidenceId ||
          !(await tx.businessAttachment.findFirst({
            where: {
              id: v.evidenceId,
              objectType: "compensation",
              objectId: id,
            },
          }))
        )
          throw new HttpError(
            400,
            "Upload refund evidence and provide reference/channel",
          );
        if (!o.paidAt || now < o.paidAt)
          throw new HttpError(400, "Refund predates payment");
        const paid = await tx.orderEvent.aggregate({
          where: {
            orderId: o.id,
            type: "PAYMENT_SUCCEEDED",
            dataKind: o.dataKind,
          },
          _sum: { amountCents: true },
        });
        if (
          o.paymentStatus !== "PAID" ||
          o.recordedRefundCents + c.amountCents > (paid._sum.amountCents ?? 0)
        )
          throw new HttpError(409, "Refund exceeds remaining verified payment");
        if (
          await tx.orderRefund.findUnique({ where: { reference: v.reference } })
        )
          throw new HttpError(409, "Refund reference is already recorded");
        const date = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
        const e = await tx.expense.create({
          data: {
            number: num("EX"),
            title: "Customer refund · " + o.number,
            categoryId: "other",
            purpose: "Customer refund linked to compensation " + c.number,
            payee: "Order " + o.number,
            createdBy: actor.id,
            assigneeId: c.executorId,
            plannedAt: date,
            dueAt: date,
            currency: c.currency,
            amount: c.amountCents,
            reportAmount: c.amountCents,
            expectedResult: "External customer refund recorded",
            resultDueAt: date,
            verificationMethod: "Private refund evidence",
            resultStatus: "CONFIRMED",
            resultEvidence: v.evidenceId,
            paymentMode: "MANUAL",
          },
        });
        const cash = await tx.cashRecord.create({
          data: {
            expenseId: e.id,
            kind: "PAYMENT",
            status: "CONFIRMED",
            amount: c.amountCents,
            currency: c.currency,
            occurredAt: now,
            actorId: actor.id,
            source: v.source,
            accountAlias: "Customer refund",
            channel: v.channel,
            reference: v.reference,
            reason: v.reason,
            reportAmount: c.amountCents,
          },
        });
        await tx.expenseLink.create({
          data: {
            expenseId: e.id,
            objectType: "order",
            objectId: o.id,
            meaning: "CUSTOMER_REFUND_SINGLE_CASH",
          },
        });
        // Only full remaining merchandise refunds have reliable line attribution; partial discretionary refunds stay unallocated.
        const allocations =
          c.type === "FULL_REFUND" && o.recordedRefundCents === 0
            ? o.lines.map((l) => ({
                lineId: l.id,
                amountCents: l.lineTotalCents,
              }))
            : [];
        const refund = await tx.orderRefund.create({
          data: {
            orderId: o.id,
            compensationId: id,
            cashId: cash.id,
            amountCents: c.amountCents,
            currency: c.currency,
            occurredAt: now,
            source: v.source,
            dataKind: o.dataKind,
            reference: v.reference,
            actorId: actor.id,
            allocations,
          },
        });
        await tx.compensation.update({
          where: { id },
          data: { expenseId: e.id },
        });
        await tx.shopOrder.update({
          where: { id: o.id },
          data: { recordedRefundCents: { increment: c.amountCents } },
        });
        await tx.orderEvent.create({
          data: {
            orderId: o.id,
            type: "REFUND_CONFIRMED",
            source: v.source,
            dataKind: o.dataKind,
            occurredAt: now,
            actorId: actor.id,
            objectType: "refund",
            objectId: refund.id,
            eventKey: "refund:" + refund.id,
            amountCents: c.amountCents,
            after: { cashId: cash.id, expenseId: e.id },
          },
        });
        status = "COMPLETED";
      }
      if (v.action === "RESERVE_REPLACEMENT") {
        if (
          c.type !== "REPLACEMENT" ||
          (await tx.replacementShipment.findUnique({
            where: { compensationId: id },
          }))
        )
          throw new HttpError(
            409,
            "Replacement already exists or unsupported type",
          );
        if (o.fulfillmentStatus === "CANCELLED")
          throw new HttpError(
            409,
            "Cancelled order cannot receive replacement",
          );
        const r = await tx.replacementShipment.create({
          data: { orderId: o.id, compensationId: id, lines: c.lines! },
        });
        for (const l of lineItems(c.lines).sort((a, b) =>
          a.variantId.localeCompare(b.variantId),
        )) {
          const b = await balance(tx, l.variantId, "MELBOURNE");
          if (available(b) < l.quantity)
            throw new HttpError(
              409,
              "Replacement has insufficient Melbourne stock",
            );
          await changeBalance(
            tx,
            actor,
            l.variantId,
            "MELBOURNE",
            { reserved: l.quantity },
            "REPLACEMENT_RESERVED",
            "replacement",
            r.id,
            v.reason,
          );
        }
        status = "EXECUTING";
      }
      if (v.action === "SHIP_REPLACEMENT") {
        const r = await tx.replacementShipment.findUnique({
          where: { compensationId: id },
        });
        if (
          c.type !== "REPLACEMENT" ||
          r?.status !== "RESERVED" ||
          !v.carrier ||
          !v.trackingNumber
        )
          throw new HttpError(
            409,
            "Reserve stock and enter carrier/tracking before dispatch",
          );
        if (now < r.createdAt)
          throw new HttpError(400, "Dispatch predates reservation");
        for (const l of lineItems(r.lines).sort((a, b) =>
          a.variantId.localeCompare(b.variantId),
        ))
          await changeBalance(
            tx,
            actor,
            l.variantId,
            "MELBOURNE",
            { reserved: -l.quantity, onHand: -l.quantity },
            "REPLACEMENT_SHIPPED",
            "replacement",
            r.id,
            v.reason,
          );
        const p = await tx.parcel.create({
          data: {
            number: num("PK"),
            type: "REPLACEMENT",
            orderId: o.id,
            assigneeId: c.executorId,
            warehouse: "MELBOURNE",
            timezone: "Australia/Melbourne",
            sourcePlace: "Melbourne",
            destinationPlace: o.state + " " + o.postcode,
            sender: "Melbourne warehouse",
            recipient: [
              o.recipientName,
              o.addressLine1,
              o.addressLine2,
              o.city,
              o.state,
              o.postcode,
            ]
              .filter(Boolean)
              .join(", "),
            carrier: v.carrier,
            trackingNumber: v.trackingNumber,
            dispatchedAt: now,
            transportStatus: "DISPATCHED",
            createdBy: actor.id,
            lines: { create: lineItems(r.lines) },
          },
        });
        await tx.parcelEvent.create({
          data: {
            parcelId: p.id,
            reference: "replacement:" + r.id,
            event: "DISPATCHED",
            occurredAt: now,
            actorId: actor.id,
            source: "MANUAL",
            reason: v.reason,
            before: {},
            after: { replacementId: r.id },
          },
        });
        await tx.replacementShipment.update({
          where: { id: r.id },
          data: { status: "SHIPPED", shippedAt: now, parcelId: p.id },
        });
        status = "COMPLETED";
      }
      if (v.action === "OTHER_COMPLETE") {
        if (c.type !== "OTHER")
          throw new HttpError(
            409,
            c.type === "COUPON"
              ? "Coupon capability is not connected; keep pending"
              : "Use the matching execution action",
          );
        if (
          !v.evidenceId ||
          !(await tx.businessAttachment.findFirst({
            where: {
              id: v.evidenceId,
              objectType: "compensation",
              objectId: id,
            },
          }))
        )
          throw new HttpError(400, "Upload result evidence");
        status = "COMPLETED";
      }
    }
    await tx.compensation.update({
      where: { id },
      data: {
        status,
        result,
        version: { increment: 1 },
        ...(status === "COMPLETED" ? { completedAt: now } : {}),
      },
    });
    await audit(
      tx,
      actor,
      "COMPENSATION_" + v.action,
      "order",
      o.id,
      v.reason,
      { compensationId: id, status: c.status },
      { compensationId: id, status, occurredAt: v.occurredAt, result },
    );
    return { id, status };
  });
}
export async function saveCampaign(actor: Actor, input: unknown) {
  owner(actor);
  const v = z
    .object({
      ...base,
      id: ident.optional(),
      version: z.number().int().optional(),
      name: z.string().trim().min(1).max(160),
      startsAt: due,
      endsAt: due,
      variantIds: z.array(ident).min(1).max(200),
      active: z.boolean(),
      notes: text,
    })
    .strict()
    .refine((v) => v.startsAt < v.endsAt, "Invalid campaign dates")
    .parse(input);
  return command(actor, "campaign-save", v.key, v, async (tx) => {
    if (v.id) await lock(tx, "campaign:" + v.id);
    const old = v.id
      ? await tx.dealCampaign.findUniqueOrThrow({ where: { id: v.id } })
      : null;
    if (old) version(old.version, v.version ?? 0);
    if (
      (await tx.productVariant.count({
        where: { id: { in: v.variantIds } },
      })) !== new Set(v.variantIds).size
    )
      throw new HttpError(400, "Choose known SKUs");
    const { id, key, reason, version: _, ...data } = v;
    void key;
    void _;
    const c = old
      ? await tx.dealCampaign.update({
          where: { id },
          data: {
            ...data,
            startsAt: new Date(v.startsAt),
            endsAt: new Date(v.endsAt),
            version: { increment: 1 },
          },
        })
      : await tx.dealCampaign.create({
          data: {
            ...data,
            startsAt: new Date(v.startsAt),
            endsAt: new Date(v.endsAt),
          },
        });
    await audit(
      tx,
      actor,
      "CAMPAIGN_ASSOCIATION_SAVED",
      "campaign",
      c.id,
      reason,
      old,
      c,
    );
    return { id: c.id };
  });
}
