import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { HttpError } from "../errors";
import {
  permit,
  command,
  audit,
  lock,
  assignee,
  base,
  currencies,
  money,
  ident,
  text,
  day,
  zone,
  occurred,
  date,
  reportAmount,
  rateFields,
  rateCheck,
  version,
  cashTotals,
  type Actor,
  type Tx,
} from "./common";
export const expenseFields = {
  title: z.string().trim().min(1).max(200),
  categoryId: ident,
  purpose: z.string().trim().min(1).max(2000),
  payee: z.string().trim().min(1).max(200),
  supplierId: ident.nullable().default(null),
  assigneeId: ident,
  plannedAt: day,
  dueAt: day,
  timezone: zone,
  currency: currencies,
  amount: money,
  ...rateFields,
  accountAlias: text,
  channel: text,
  expectedResult: z.string().trim().min(1).max(2000),
  resultDueAt: day,
  verificationMethod: z.string().trim().min(1).max(1000),
  paymentMode: z.enum(["MANUAL", "PROVIDER_AUTO"]),
  tolerance: money.default(0),
  graceDays: z.number().int().min(0).max(90).default(0),
  reminderDays: z.number().int().min(0).max(90).default(7),
  notes: text,
};
export async function saveExpense(actor: Actor, input: unknown) {
  await permit(actor, "finance");
  const v = z
    .object({
      ...base,
      ...expenseFields,
      id: ident.optional(),
      version: z.number().int().positive().optional(),
      acknowledgePayments: z.boolean().default(false),
    })
    .strict()
    .parse(input);
  rateCheck(v);
  return command(actor, "expense-save", v.key, v, async (tx) => {
    if (v.id) await lock(tx, "expense:" + v.id);
    const old = v.id
      ? await tx.expense.findUniqueOrThrow({
          where: { id: v.id },
          include: { cash: true },
        })
      : null;
    if (old) {
      version(old.version, v.version ?? 0);
      if (old.purchaseId)
        throw new HttpError(
          409,
          "Revise the linked purchase for its total; use expense actions for results and refund expectations",
        );
      if (old.status !== "OPEN")
        throw new HttpError(409, "Cancelled expense cannot be overwritten");
      if (old.cash.length && !v.acknowledgePayments)
        throw new HttpError(
          409,
          "Acknowledge existing payment history before changing this obligation",
        );
      if (old.currency !== v.currency)
        throw new HttpError(
          409,
          "Currency cannot change; create a separate obligation",
        );
    }
    await assignee(tx, v.assigneeId);
    if (
      !(await tx.expenseCategory.findFirst({
        where: { id: v.categoryId, active: true },
      }))
    )
      throw new HttpError(400, "Choose an active category");
    const { key, reason, id, version: _, acknowledgePayments, ...raw } = v;
    void key;
    void _;
    void acknowledgePayments;
    const data = {
      ...raw,
      plannedAt: date(v.plannedAt)!,
      dueAt: date(v.dueAt)!,
      resultDueAt: date(v.resultDueAt)!,
      rateDate: date(v.rateDate),
      reportAmount: reportAmount(v.amount, v.currency, v.rateMicros),
    };
    const e = id
      ? await tx.expense.update({
          where: { id },
          data: { ...data, version: { increment: 1 } },
        })
      : await tx.expense.create({
          data: {
            ...data,
            number: "EX-" + randomUUID().slice(0, 12).toUpperCase(),
            createdBy: actor.id,
          },
        });
    await audit(tx, actor, "EXPENSE_SAVED", "expense", e.id, reason, old, e);
    return { id: e.id };
  });
}
export async function recordCash(actor: Actor, id: string, input: unknown) {
  await permit(actor, "finance");
  const v = z
    .object({
      ...base,
      kind: z.enum(["PAYMENT", "REFUND", "REVERSAL"]),
      status: z.enum(["CONFIRMED", "FAILED"]),
      amount: money.min(1),
      currency: currencies,
      occurredAt: occurred,
      source: z.enum(["MANUAL", "TEST"]),
      accountAlias: z.string().trim().min(1).max(200),
      channel: z.string().trim().min(1).max(120),
      reference: z.string().trim().min(3).max(150),
      correctionOf: ident.nullable().default(null),
      ...rateFields,
    })
    .strict()
    .parse(input);
  rateCheck(v);
  return command(actor, "cash-record", v.key, { id, ...v }, async (tx) => {
    await lock(tx, "expense:" + id);
    const expense = await tx.expense.findUniqueOrThrow({
      where: { id },
      include: { cash: true },
    });
    if (expense.currency !== v.currency)
      throw new HttpError(
        400,
        "Cash currency must match the obligation; no automatic cross-currency settlement",
      );
    const existing = expense.cash.find(
      (c) => c.reference === v.reference && c.kind === v.kind,
    );
    if (existing) {
      if (
        existing.amount !== v.amount ||
        existing.status !== v.status ||
        existing.source !== v.source
      )
        throw new HttpError(
          409,
          "Reference already recorded with different values",
        );
      return { id, cashId: existing.id, replayed: true };
    }
    if (expense.status === "CANCELLED" && v.kind === "PAYMENT")
      throw new HttpError(
        409,
        "Cancelled obligation cannot receive a new payment",
      );
    let original: (typeof expense.cash)[number] | null = null;
    if (v.kind === "REVERSAL") {
      original = expense.cash.find((c) => c.id === v.correctionOf) ?? null;
      if (
        !original ||
        original.kind === "REVERSAL" ||
        original.amount !== v.amount ||
        original.source !== v.source ||
        v.status !== "CONFIRMED" ||
        expense.cash.some((c) => c.correctionOf === v.correctionOf)
      )
        throw new HttpError(
          409,
          "Reverse an original record once, for the same amount and source",
        );
    } else if (v.correctionOf)
      throw new HttpError(400, "Use a reversal to correct an existing record");
    const totals = cashTotals(expense.cash, v.source === "TEST");
    if (v.source === "TEST") {
      const test = cashTotals(
        expense.cash.filter((c) => c.source === "TEST"),
        true,
      );
      totals.paid = test.paid;
      totals.refund = test.refund;
    }
    if (
      v.kind === "REFUND" &&
      v.status === "CONFIRMED" &&
      v.amount > totals.paid - totals.refund
    )
      throw new HttpError(409, "Refund exceeds recorded net payment");
    if (
      original?.kind === "PAYMENT" &&
      original.status === "CONFIRMED" &&
      totals.paid - original.amount < totals.refund
    )
      throw new HttpError(
        409,
        "Reverse dependent refunds before reversing this payment",
      );
    const { key, reason, ...raw } = v;
    void key;
    const record = await tx.cashRecord.create({
      data: {
        ...raw,
        expenseId: id,
        actorId: actor.id,
        reason,
        occurredAt: new Date(v.occurredAt),
        rateDate: date(v.rateDate),
        reportAmount: reportAmount(v.amount, v.currency, v.rateMicros),
      },
    });
    await audit(tx, actor, "CASH_" + v.kind, "expense", id, reason, undefined, {
      cashId: record.id,
      kind: v.kind,
      status: v.status,
      amount: v.amount,
      currency: v.currency,
      source: v.source,
      occurredAt: v.occurredAt,
      correctionOf: v.correctionOf,
    });
    return { id, cashId: record.id };
  });
}
export async function expenseAction(actor: Actor, id: string, input: unknown) {
  await permit(actor, "finance");
  const v = z
    .object({
      ...base,
      version: z.number().int().positive(),
      action: z.enum(["RESULT", "CANCEL", "REFUND_EXPECTED"]),
      evidence: text,
      expectedRefund: money.default(0),
      refundDueAt: day.nullable().default(null),
    })
    .strict()
    .parse(input);
  return command(actor, "expense-action", v.key, { id, ...v }, async (tx) => {
    await lock(tx, "expense:" + id);
    const e = await tx.expense.findUniqueOrThrow({
      where: { id },
      include: { cash: true },
    });
    version(e.version, v.version);
    if (v.action === "RESULT") {
      if (e.purchaseId)
        throw new HttpError(
          409,
          "Purchase delivery is confirmed by the shared receiving service",
        );
      if (!v.evidence.trim())
        throw new HttpError(
          400,
          "Record evidence of the actual service outcome",
        );
      await tx.expense.update({
        where: { id },
        data: {
          resultStatus: "CONFIRMED",
          resultEvidence: v.evidence,
          resultConfirmedAt: new Date(),
          version: { increment: 1 },
        },
      });
    } else if (v.action === "CANCEL") {
      if (e.purchaseId)
        throw new HttpError(
          409,
          "Cancel the purchase remainder through its business record",
        );
      if (cashTotals(e.cash).net > 0)
        throw new HttpError(
          409,
          "Record actual refund or correction first; cancellation cannot erase cash paid",
        );
      await tx.expense.update({
        where: { id },
        data: { status: "CANCELLED", version: { increment: 1 } },
      });
    } else {
      if (!v.refundDueAt || !v.expectedRefund)
        throw new HttpError(400, "Enter expected refund and deadline");
      await tx.expense.update({
        where: { id },
        data: {
          expectedRefund: v.expectedRefund,
          refundDueAt: date(v.refundDueAt),
          version: { increment: 1 },
        },
      });
    }
    await audit(
      tx,
      actor,
      "EXPENSE_" + v.action,
      "expense",
      id,
      v.reason,
      e,
      v,
    );
    return { id };
  });
}
export async function linkExpense(actor: Actor, id: string, input: unknown) {
  await permit(actor, "finance");
  const v = z
    .object({
      ...base,
      objectType: z.enum(["parcel", "transfer", "order", "subscription"]),
      objectId: ident,
      meaning: z.enum(["INCLUDED_IN_PURCHASE", "INDEPENDENT_FEE"]),
    })
    .strict()
    .parse(input);
  return command(actor, "expense-link", v.key, { id, ...v }, async (tx) => {
    const e = await tx.expense.findUniqueOrThrow({ where: { id } });
    if ((v.meaning === "INCLUDED_IN_PURCHASE") !== !!e.purchaseId)
      throw new HttpError(
        400,
        "An included charge must reference the original purchase expense; independent fees use a separate expense",
      );
    if (v.objectType === "parcel") {
      const p = await tx.parcel.findUniqueOrThrow({
        where: { id: v.objectId },
      });
      if (e.purchaseId && p.purchaseId !== e.purchaseId)
        throw new HttpError(
          400,
          "Included charge must refer to the same purchase",
        );
    } else if (v.objectType === "transfer")
      await tx.transfer.findUniqueOrThrow({ where: { id: v.objectId } });
    else if (v.objectType === "order")
      await tx.shopOrder.findUniqueOrThrow({ where: { id: v.objectId } });
    else
      await tx.recurringExpense.findUniqueOrThrow({
        where: { id: v.objectId },
      });
    const data = {
      expenseId: id,
      objectType: v.objectType,
      objectId: v.objectId,
      meaning: v.meaning,
    };
    await tx.expenseLink.upsert({
      where: {
        expenseId_objectType_objectId: {
          expenseId: id,
          objectType: v.objectType,
          objectId: v.objectId,
        },
      },
      create: data,
      update: { meaning: v.meaning },
    });
    await audit(
      tx,
      actor,
      "EXPENSE_LINK",
      "expense",
      id,
      v.reason,
      undefined,
      data,
    );
    return { id };
  });
}
export async function saveExpenseCategory(actor: Actor, input: unknown) {
  await permit(actor, "finance");
  const v = z
    .object({
      ...base,
      id: z.string().regex(/^[a-z0-9-]{1,80}$/),
      name: z.string().trim().min(1).max(100),
      active: z.boolean(),
    })
    .parse(input);
  return command(actor, "expense-category", v.key, v, async (tx) => {
    const old = await tx.expenseCategory.findUnique({ where: { id: v.id } });
    const e = await tx.expenseCategory.upsert({
      where: { id: v.id },
      create: { id: v.id, name: v.name, active: v.active },
      update: { name: v.name, active: v.active },
    });
    await audit(
      tx,
      actor,
      "EXPENSE_CATEGORY",
      "expense-category",
      v.id,
      v.reason,
      old,
      e,
    );
    return { id: v.id };
  });
}
export async function cashState(tx: Tx, id: string) {
  const e = await tx.expense.findUniqueOrThrow({
    where: { id },
    include: { cash: true },
  });
  const t = cashTotals(e.cash);
  return {
    ...t,
    outstanding: Math.max(0, e.amount - t.paid),
    paymentStatus: t.refund
      ? "REFUND_RECORDED"
      : t.paid === 0
        ? "UNPAID"
        : t.paid < e.amount
          ? "PART_PAID"
          : "PAID",
  };
}
