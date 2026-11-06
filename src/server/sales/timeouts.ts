import "server-only";
import { z } from "zod";
import { database } from "../db";
import { HttpError } from "../errors";
import { base, day, zone, ident, version, plain } from "../business/common";
import { command, lock, audit, type Actor, type Tx } from "../operations/core";
import { permit, accessOrder } from "./access";
import { localDay, dateBounds } from "../notifications/time";
import { validatePeople } from "../notifications/access";
import type { Issue } from "../notifications/engine";
export const kinds = [
  "SHIPMENT",
  "DELIVERY",
  "FIRST_RESPONSE",
  "CASE_RESOLUTION",
  "COMPENSATION",
] as const;
export const ruleSchema = z
  .object({
    ...base,
    kind: z.enum(kinds),
    version: z.number().int().nonnegative(),
    enabled: z.boolean(),
    days: z.number().int().min(0).max(365),
    dayMode: z.enum(["CALENDAR", "BUSINESS"]),
    timezone: zone,
    weekends: z.array(z.number().int().min(0).max(6)).max(6),
    holidays: z.array(day).max(366),
    shippingMethod: z.literal("STANDARD_AU"),
    includeTest: z.boolean(),
    assigneeId: ident,
    recipientIds: z.array(ident).min(1).max(100),
    confirmerIds: z.array(ident).min(1).max(100),
    severity: z.number().int().min(0).max(3),
    pin: z.boolean(),
    escalateDays: z.number().int().min(1).max(90),
    apply: z.enum(["FUTURE", "RECALCULATE"]),
  })
  .strict();
type Calendar = {
  days: number;
  dayMode: string;
  timezone: string;
  weekends: number[];
  holidays: string[];
};
export function deadline(anchor: Date, r: Calendar) {
  let d = localDay(
      anchor,
      r.timezone as "Australia/Melbourne" | "Asia/Shanghai",
    ),
    n = 0,
    steps = 0;
  while (n < r.days) {
    d = new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);
    if (++steps > 4000) throw new Error("Invalid business calendar");
    if (
      r.dayMode === "CALENDAR" ||
      (!r.weekends.includes(new Date(d).getUTCDay()) && !r.holidays.includes(d))
    )
      n++;
  }
  return dateBounds(d, r.timezone as "Australia/Melbourne" | "Asia/Shanghai")
    .lt;
}
export async function saveRule(actor: Actor, input: unknown) {
  await permit(actor, "orderRules");
  const v = ruleSchema.parse(input);
  return command(actor, "order-timeout-rule", v.key, v, async (tx) => {
    await lock(tx, "notification-scan");
    const old = await tx.orderTimeoutRule.findFirst({
      where: { kind: v.kind },
      orderBy: { version: "desc" },
    });
    version(old?.version ?? 0, v.version);
    await validatePeople(
      tx,
      v.kind === "COMPENSATION" ? "FINANCE" : "ORDER",
      null,
      [v.assigneeId, ...v.recipientIds, ...v.confirmerIds],
    );
    const { key, apply, version: _, ...data } = v;
    void key;
    void _;
    const r = await tx.orderTimeoutRule.create({
      data: { ...data, version: v.version + 1, createdBy: actor.id },
    });
    if (apply === "RECALCULATE") {
      const timers = await tx.orderTimer.findMany({
        where: { kind: v.kind, active: true },
        include: { pauses: true },
      });
      for (const t of timers)
        await tx.orderTimer.update({
          where: { id: t.id },
          data: {
            ruleId: r.id,
            ruleSnapshot: plain(r),
            deadlineAt: new Date(
              deadline(t.anchorAt, r).getTime() +
                t.pauses.reduce(
                  (n, p) => n + p.endsAt.getTime() - p.startsAt.getTime(),
                  0,
                ),
            ),
          },
        });
    }
    await audit(
      tx,
      actor,
      "ORDER_RULE_SAVED",
      "order-rule",
      r.id,
      v.reason,
      old,
      { ...r, apply },
    );
    return { id: r.id, version: r.version };
  });
}
export async function pauseTimer(actor: Actor, id: string, input: unknown) {
  await permit(actor, "orderRules");
  const v = z
    .object({ ...base, endsAt: z.string().datetime({ offset: true }) })
    .strict()
    .parse(input);
  return command(
    actor,
    "order-timer-pause",
    v.key,
    { id, ...v },
    async (tx) => {
      await lock(tx, "notification-scan");
      const t = await tx.orderTimer.findUniqueOrThrow({
        where: { id },
        include: { pauses: true },
      });
      await accessOrder(actor, t.orderId, tx);
      const startsAt = new Date(),
        endsAt = new Date(v.endsAt);
      const ms = endsAt.getTime() - startsAt.getTime(),
        past = t.pauses.reduce(
          (n, p) => n + p.endsAt.getTime() - p.startsAt.getTime(),
          0,
        );
      if (
        !t.active ||
        ms <= 0 ||
        ms > 14 * 86400000 ||
        past + ms > 30 * 86400000 ||
        t.pauses.some((p) => p.endsAt > startsAt)
      )
        throw new HttpError(
          400,
          "Pause must end within 14 days, cannot overlap and total pauses cannot exceed 30 days",
        );
      const p = await tx.orderTimerPause.create({
        data: {
          timerId: id,
          startsAt,
          endsAt,
          actorId: actor.id,
          reason: v.reason,
        },
      });
      await tx.orderTimer.update({
        where: { id },
        data: { deadlineAt: new Date(t.deadlineAt.getTime() + ms) },
      });
      await audit(
        tx,
        actor,
        "ORDER_TIMER_PAUSED",
        "order",
        t.orderId,
        v.reason,
        undefined,
        {
          timerId: id,
          startsAt,
          endsAt,
          totalPausedHours: (past + ms) / 3600000,
        },
      );
      return { id: p.id };
    },
  );
}
export async function timeoutIssues(
  tx: Tx,
  now = new Date(),
): Promise<Issue[]> {
  const all = await tx.orderTimeoutRule.findMany({
      orderBy: { version: "desc" },
    }),
    latest = [...new Map([...all].reverse().map((r) => [r.kind, r])).values()];
  const [orders, cases, comps] = await Promise.all([
    tx.shopOrder.findMany({
      where: { paymentStatus: "PAID", fulfillmentStatus: { not: "CANCELLED" } },
    }),
    tx.aftercareCase.findMany({
      where: { status: { notIn: ["RESOLVED", "CLOSED"] } },
      include: { order: true },
    }),
    tx.compensation.findMany({
      where: { status: { in: ["APPROVED", "EXECUTING", "FAILED"] } },
      include: { order: true, case: true },
    }),
  ]);
  const issues: Issue[] = [],
    active: string[] = [];
  for (const r of latest.filter((r) => r.enabled)) {
    const candidates: {
      orderId: string;
      objectId: string;
      anchor: Date;
      title: string;
      objectType: string;
      kind: string;
    }[] = [];
    const eligible = (kind: string) =>
      kind === "REAL" || (r.includeTest && kind === "TEST");
    if (r.kind === "SHIPMENT" || r.kind === "DELIVERY")
      for (const o of orders) {
        if (!eligible(o.dataKind) || o.shippingMethod !== r.shippingMethod)
          continue;
        if (r.kind === "SHIPMENT" && o.paidAt && !o.shippedAt)
          candidates.push({
            orderId: o.id,
            objectId: o.id,
            anchor: o.paidAt,
            title: o.number + " · paid but not shipped",
            objectType: "order",
            kind: o.dataKind,
          });
        if (
          r.kind === "DELIVERY" &&
          o.shippedAt &&
          !o.deliveredAt &&
          o.etaDelivery
        )
          candidates.push({
            orderId: o.id,
            objectId: o.id,
            anchor: dateBounds(
              o.etaDelivery.toISOString().slice(0, 10),
              r.timezone as "Australia/Melbourne" | "Asia/Shanghai",
            ).gte,
            title: o.number + " · delivery not recorded",
            objectType: "order",
            kind: o.dataKind,
          });
      }
    if (r.kind === "FIRST_RESPONSE" || r.kind === "CASE_RESOLUTION")
      for (const c of cases) {
        if (
          !eligible(c.order.dataKind) ||
          (c.source === "TEST" && !r.includeTest) ||
          (r.kind === "FIRST_RESPONSE" && c.firstResponseAt)
        )
          continue;
        candidates.push({
          orderId: c.orderId,
          objectId: c.id,
          anchor: r.kind === "FIRST_RESPONSE" ? c.occurredAt : c.dueAt,
          title:
            c.number +
            (r.kind === "FIRST_RESPONSE"
              ? " · first response overdue"
              : " · case resolution overdue"),
          objectType: "case",
          kind: c.source === "TEST" ? "TEST" : c.order.dataKind,
        });
      }
    if (r.kind === "COMPENSATION")
      for (const c of comps) {
        if (
          !eligible(c.order.dataKind) ||
          (c.case.source === "TEST" && !r.includeTest)
        )
          continue;
        candidates.push({
          orderId: c.orderId,
          objectId: c.id,
          anchor: c.dueAt,
          title: c.number + " · approved execution overdue",
          objectType: "compensation",
          kind: c.case.source === "TEST" ? "TEST" : c.order.dataKind,
        });
      }
    for (const c of candidates) {
      let t = await tx.orderTimer.findUnique({
        where: { kind_objectId: { kind: r.kind, objectId: c.objectId } },
        include: { pauses: true },
      });
      if (!t) {
        t = await tx.orderTimer.create({
          data: {
            kind: r.kind,
            orderId: c.orderId,
            objectId: c.objectId,
            anchorAt: c.anchor,
            deadlineAt: deadline(c.anchor, r),
            ruleId: r.id,
            ruleSnapshot: plain(r),
          },
          include: { pauses: true },
        });
      } else if (t.anchorAt.getTime() !== c.anchor.getTime()) {
        t = await tx.orderTimer.update({
          where: { id: t.id },
          data: {
            anchorAt: c.anchor,
            deadlineAt: new Date(
              deadline(c.anchor, r).getTime() +
                t.pauses.reduce(
                  (n, p) => n + p.endsAt.getTime() - p.startsAt.getTime(),
                  0,
                ),
            ),
            ruleId: r.id,
            ruleSnapshot: plain(r),
            active: true,
          },
          include: { pauses: true },
        });
      } else if (!t.active)
        t = await tx.orderTimer.update({
          where: { id: t.id },
          data: { active: true },
          include: { pauses: true },
        });
      active.push(t.id);
      if (
        t.deadlineAt >= now ||
        t.pauses.some((p) => p.startsAt <= now && p.endsAt > now)
      )
        continue;
      const snapshot = t.ruleSnapshot as unknown as typeof r;
      const escalated =
        now.getTime() - t.deadlineAt.getTime() >
        snapshot.escalateDays * 86400000;
      issues.push({
        key: "order-timeout:" + t.id,
        type: r.kind === "COMPENSATION" ? "FINANCE" : "ORDER",
        severity: Math.min(3, snapshot.severity + (escalated ? 1 : 0)),
        title: c.title,
        reason: `No completion has been recorded by the configured deadline. ${c.kind === "TEST" ? "TEST data. " : ""}Calendar: ${snapshot.timezone}.`,
        action:
          "Verify the business record. A timeout does not authorize a refund.",
        objectType: c.objectType,
        objectId: c.objectId,
        pin: snapshot.pin,
        occurredAt: c.anchor,
        deadlineAt: t.deadlineAt,
        data: {
          timerId: t.id,
          orderId: c.orderId,
          dataKind: c.kind,
          pausedHours:
            t.pauses.reduce(
              (n, p) => n + p.endsAt.getTime() - p.startsAt.getTime(),
              0,
            ) / 3600000,
          totalWaitingHours: (now.getTime() - c.anchor.getTime()) / 3600000,
        },
        material: {
          timerId: t.id,
          deadline: t.deadlineAt,
          ruleVersion: snapshot.version,
          escalated,
        },
        route: {
          assigneeId: snapshot.assigneeId,
          recipientIds: snapshot.recipientIds,
          confirmerIds: snapshot.confirmerIds,
        },
        ruleVersion: snapshot.version,
        ruleSnapshot: plain(snapshot),
      });
    }
  }
  await tx.orderTimer.updateMany({
    where: { active: true, id: { notIn: active } },
    data: { active: false },
  });
  return issues;
}
export async function rules(actor: Actor) {
  await permit(actor, "orderRules");
  const rows = await database().orderTimeoutRule.findMany({
    orderBy: { version: "desc" },
  });
  return {
    items: [...new Map([...rows].reverse().map((r) => [r.kind, r])).values()],
    history: rows,
    kinds,
  };
}
