import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { HttpError } from "../errors";
import { localDay } from "../notifications/time";
import { cycleDate, indexAtOrAfter } from "./calendar";
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
  date,
  version,
  type Actor,
  type Tx,
} from "./common";
const schema = z
  .object({
    ...base,
    id: ident.optional(),
    version: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(200),
    payee: z.string().trim().min(1).max(200),
    categoryId: ident,
    assigneeId: ident,
    currency: currencies,
    amount: money,
    unit: z.enum(["DAY", "WEEK", "MONTH", "YEAR"]),
    interval: z.number().int().min(1).max(365),
    anchorDate: day,
    endDate: day.nullable(),
    timezone: zone,
    reminderDays: z.number().int().min(0).max(90),
    graceDays: z.number().int().min(0).max(90),
    paymentMode: z.enum(["MANUAL", "PROVIDER_AUTO"]),
    expectedResult: z.string().trim().min(1).max(2000),
    verificationMethod: z.string().trim().min(1).max(1000),
    accountAlias: text,
    channel: text,
    tolerance: money,
    status: z.enum(["ACTIVE", "PAUSED", "ENDED"]),
    resumeFrom: day.optional(),
  })
  .strict()
  .refine(
    (v) => !v.endDate || v.endDate >= v.anchorDate,
    "End date precedes start",
  );
export async function saveRecurring(actor: Actor, input: unknown) {
  await permit(actor, "recurring");
  await permit(actor, "finance");
  const v = schema.parse(input);
  return command(actor, "recurring-save", v.key, v, async (tx) => {
    await lock(tx, "notification-scan");
    if (v.id) await lock(tx, "recurring:" + v.id);
    const old = v.id
      ? await tx.recurringExpense.findUniqueOrThrow({ where: { id: v.id } })
      : null;
    if (old) version(old.version, v.version ?? 0);
    await assignee(tx, v.assigneeId);
    if (
      !(await tx.expenseCategory.findFirst({
        where: { id: v.categoryId, active: true },
      }))
    )
      throw new HttpError(400, "Choose an active category");
    const today = localDay(new Date(), v.timezone);
    if (
      old &&
      old.status !== "ACTIVE" &&
      v.status === "ACTIVE" &&
      !v.resumeFrom
    )
      throw new HttpError(
        400,
        "Select an explicit resume date; missed periods are not silently generated",
      );
    const { key, reason, id, version: _, resumeFrom, ...raw } = v;
    void key;
    void _;
    const schedule = {
      ...raw,
      anchorDate: date(v.anchorDate)!,
      endDate: date(v.endDate),
    };
    const scheduleChanged =
      old &&
      (old.anchorDate.toISOString().slice(0, 10) !== v.anchorDate ||
        old.unit !== v.unit ||
        old.interval !== v.interval);
    const start = resumeFrom ?? today;
    if (resumeFrom && resumeFrom < today)
      throw new HttpError(
        400,
        "Resume from today or later; use explicit bounded Backfill for historical periods",
      );
    const nextIndex =
      !old || scheduleChanged || old.status !== "ACTIVE"
        ? indexAtOrAfter(schedule, start)
        : old.nextIndex;
    const r = id
      ? await tx.recurringExpense.update({
          where: { id },
          data: { ...schedule, nextIndex, version: { increment: 1 } },
        })
      : await tx.recurringExpense.create({
          data: { ...schedule, nextIndex, createdBy: actor.id },
        });
    await audit(
      tx,
      actor,
      "RECURRING_SAVED",
      "recurring",
      r.id,
      reason,
      old,
      r,
    );
    return { id: r.id, nextDue: cycleDate(r, r.nextIndex) };
  });
}
async function generate(
  tx: Tx,
  r: Awaited<ReturnType<Tx["recurringExpense"]["findUniqueOrThrow"]>>,
  cycle: string,
) {
  if (
    await tx.expense.findUnique({
      where: { recurringId_cycle: { recurringId: r.id, cycle } },
    })
  )
    return false;
  await tx.expense.create({
    data: {
      number: "EX-" + randomUUID().slice(0, 12).toUpperCase(),
      title: r.name + " · " + cycle,
      categoryId: r.categoryId,
      purpose: "Recurring service obligation; not evidence of payment",
      payee: r.payee,
      createdBy: r.createdBy,
      assigneeId: r.assigneeId,
      plannedAt: date(cycle)!,
      dueAt: date(cycle)!,
      timezone: r.timezone,
      currency: r.currency,
      amount: r.amount,
      reportAmount: r.currency === "AUD" ? r.amount : null,
      accountAlias: r.accountAlias,
      channel: r.channel,
      expectedResult: r.expectedResult,
      resultDueAt: date(cycle)!,
      verificationMethod: r.verificationMethod,
      paymentMode: r.paymentMode,
      tolerance: r.tolerance,
      graceDays: r.graceDays,
      reminderDays: r.reminderDays,
      recurringId: r.id,
      cycle,
      source: "AUTOMATIC",
    },
  });
  return true;
}
export async function generateRecurring(tx: Tx) {
  let generated = 0;
  const rules = await tx.recurringExpense.findMany({
    where: { status: "ACTIVE" },
    orderBy: { id: "asc" },
  });
  for (const r of rules) {
    const today = localDay(
        new Date(),
        r.timezone as "Asia/Shanghai" | "Australia/Melbourne",
      ),
      limit = new Date(Date.parse(today) + r.reminderDays * 86400000)
        .toISOString()
        .slice(0, 10);
    let index = r.nextIndex;
    for (let n = 0; n < 50; n++) {
      const cycle = cycleDate(r, index);
      if (
        cycle > limit ||
        (r.endDate && cycle > r.endDate.toISOString().slice(0, 10))
      )
        break;
      if (await generate(tx, r, cycle)) generated++;
      index++;
    }
    if (index !== r.nextIndex)
      await tx.recurringExpense.update({
        where: { id: r.id },
        data: { nextIndex: index },
      });
  }
  return generated;
}
export async function backfillRecurring(
  actor: Actor,
  id: string,
  input: unknown,
) {
  await permit(actor, "recurring");
  await permit(actor, "finance");
  const v = z
    .object({
      ...base,
      from: day,
      to: day,
      preview: z.boolean(),
      expectedCount: z.number().int().min(0).max(100).optional(),
    })
    .refine((v) => v.from <= v.to, "Date range is reversed")
    .parse(input);
  return command(
    actor,
    "recurring-backfill",
    v.key,
    { id, ...v },
    async (tx) => {
      await lock(tx, "notification-scan");
      const r = await tx.recurringExpense.findUniqueOrThrow({ where: { id } });
      if (
        v.to >
        localDay(
          new Date(),
          r.timezone as "Asia/Shanghai" | "Australia/Melbourne",
        )
      )
        throw new HttpError(400, "Historical backfill ends today or earlier");
      const cycles: string[] = [];
      for (let i = indexAtOrAfter(r, v.from); ; i++) {
        const c = cycleDate(r, i);
        if (c > v.to || (r.endDate && c > r.endDate.toISOString().slice(0, 10)))
          break;
        if (
          !(await tx.expense.findUnique({
            where: { recurringId_cycle: { recurringId: id, cycle: c } },
          }))
        )
          cycles.push(c);
        if (cycles.length > 100)
          throw new HttpError(400, "Backfill at most 100 periods at a time");
      }
      if (v.preview) return { id, cycles, count: cycles.length };
      if (v.expectedCount !== cycles.length)
        throw new HttpError(409, "Period count changed; preview again");
      for (const c of cycles) await generate(tx, r, c);
      await audit(
        tx,
        actor,
        "RECURRING_BACKFILL",
        "recurring",
        id,
        v.reason,
        undefined,
        { from: v.from, to: v.to, cycles },
      );
      return { id, count: cycles.length };
    },
  );
}
