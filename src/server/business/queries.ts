import "server-only";
import { z } from "zod";
import { database } from "../db";
import { HttpError } from "../errors";
import { staff, csv } from "../operations/core";
import {
  permit,
  owner,
  command,
  audit,
  base,
  ident,
  capabilities,
  day,
  currencies,
  cashTotals,
  history,
  type Actor,
} from "./common";
import { remainingPurchase } from "./purchases";
import { logisticsList, parcelDetail } from "./logistics";
import { cycleDate } from "./calendar";
import { attachmentPermission } from "./attachments";
import { localDay } from "../notifications/time";
const querySchema = z
  .object({
    q: z.string().max(200).optional(),
    status: z.string().max(60).optional(),
    supplier: ident.optional(),
    assignee: ident.optional(),
    category: ident.optional(),
    currency: currencies.optional(),
    payment: z
      .enum(["UNPAID", "PART_PAID", "PAID", "REFUND_RECORDED", "UNVERIFIED"])
      .optional(),
    result: z.enum(["PENDING", "CONFIRMED"]).optional(),
    from: day.optional(),
    to: day.optional(),
    dateField: z
      .enum([
        "created",
        "due",
        "paid",
        "dispatched",
        "eta",
        "signed",
        "received",
      ])
      .default("created"),
    type: z.string().max(80).optional(),
    warehouse: z.enum(["BEIJING", "MELBOURNE"]).optional(),
    sourceWarehouse: z.enum(["BEIJING", "MELBOURNE"]).optional(),
    carrier: z.string().max(120).optional(),
    acceptance: z.string().max(80).optional(),
    linkedType: z
      .enum(["purchase", "parcel", "transfer", "order", "subscription"])
      .optional(),
    linkedId: ident.optional(),
    min: z.coerce.number().int().min(0).optional(),
    max: z.coerce.number().int().min(0).optional(),
    overdue: z.enum(["true", "false"]).optional(),
    failed: z.enum(["true", "false"]).optional(),
    missingEvidence: z.enum(["true", "false"]).optional(),
    unfinished: z.enum(["true", "false"]).optional(),
    discrepancy: z.enum(["true", "false"]).optional(),
    sort: z.enum(["newest", "oldest", "amount-desc"]).default("newest"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    format: z.enum(["csv"]).optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, "Reversed date range");
const contains = (a: unknown, b?: string) =>
  !b ||
  String(a ?? "")
    .toLowerCase()
    .includes(b.toLowerCase());
function paging<T>(
  items: T[],
  q: { page: number; pageSize: number; sort: string },
  all = false,
) {
  const total = items.length,
    pageCount = Math.max(1, Math.ceil(total / q.pageSize)),
    page = Math.min(q.page, pageCount);
  return {
    items: all
      ? items
      : items.slice((page - 1) * q.pageSize, page * q.pageSize),
    total,
    page,
    pageCount,
  };
}
export async function metadata(actor: Actor) {
  staff(actor);
  const db = database();
  const grants =
    actor.role === "admin"
      ? [...capabilities]
      : (await db.businessGrant.findMany({ where: { userId: actor.id } })).map(
          (g) => g.capability,
        );
  return {
    actor,
    capabilities: grants,
    currencies: ["AUD", "CNY", "USD", "EUR", "GBP"],
    people: await db.user.findMany({
      where: { active: true, role: { in: ["admin", "warehouse"] } },
      select: { id: true, name: true, role: true },
    }),
    skus: await db.productVariant.findMany({
      select: {
        id: true,
        sku: true,
        size: true,
        color: true,
        product: { select: { name: true } },
      },
      orderBy: { sku: "asc" },
    }),
    suppliers: grants.some((x) => ["finance", "procurement"].includes(x))
      ? await db.supplier.findMany({
          where: { archived: false },
          select: { id: true, name: true, currency: true },
        })
      : [],
    categories: grants.includes("finance")
      ? await db.expenseCategory.findMany({ orderBy: { id: "asc" } })
      : [],
    purchases: await db.purchase.findMany({
      where:
        actor.role === "admin" || grants.includes("procurement")
          ? {}
          : { warehouse: "MELBOURNE" },
      select: { id: true, number: true, warehouse: true, status: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    transfers: await db.transfer.findMany({
      select: { id: true, number: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    orders: await db.shopOrder.findMany({
      where: { shippedAt: { not: null } },
      select: { id: true, number: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    returns: (
      await db.orderReturn.findMany({
        select: { id: true, orderId: true },
        take: 200,
      })
    ).map((r) => ({ ...r, label: "Return " + r.id.slice(-8) })),
    parcels: (
      await db.parcel.findMany({
        select: { id: true, number: true, type: true, warehouse: true },
        take: 200,
      })
    ).filter(
      (p) =>
        actor.role === "admin" ||
        p.warehouse === "MELBOURNE" ||
        p.type.startsWith("CUSTOMER"),
    ),
    recurring: grants.includes("finance")
      ? await db.recurringExpense.findMany({ select: { id: true, name: true } })
      : [],
  };
}
export async function suppliers(actor: Actor, raw: unknown) {
  await permit(actor, "procurement");
  const q = querySchema.parse(raw);
  const rows = await database().supplier.findMany({
    include: { sources: true },
    orderBy: { createdAt: "desc" },
  });
  return paging(
    rows.filter(
      (r) =>
        contains(r.code + " " + r.name + " " + r.contact, q.q) &&
        (!q.status || (q.status === "ARCHIVED") === r.archived),
    ),
    q,
  );
}
export async function purchases(actor: Actor, raw: unknown) {
  await permit(actor, "procurement");
  const q = querySchema.parse(raw);
  const rows = await database().purchase.findMany({
    include: { lines: true, expense: { include: { cash: true } } },
    orderBy: { createdAt: "desc" },
  });
  const selected = rows
    .map((p) => {
      const c = cashTotals(p.expense?.cash ?? []),
        remaining = p.lines.reduce((n, l) => n + remainingPurchase(l), 0),
        received = p.lines.reduce(
          (n, l) => n + l.receivedSellable + l.receivedUnavailable,
          0,
        );
      return {
        ...p,
        paymentStatus: c.refund
          ? "REFUND_RECORDED"
          : !c.paid
            ? "UNPAID"
            : c.paid < p.total
              ? "PART_PAID"
              : "PAID",
        receiptStatus: p.lines.some(
          (l) => l.shortClosedQty + l.receivedUnavailable > 0,
        )
          ? "DIFFERENCE_RECORDED"
          : remaining === 0
            ? "ACCOUNTED_FOR"
            : received
              ? "PART_RECEIVED"
              : "NOT_RECEIVED",
        remaining,
        received,
        expense: undefined,
      };
    })
    .filter(
      (p) =>
        contains(
          p.number +
            " " +
            JSON.stringify(p.supplierSnapshot) +
            " " +
            JSON.stringify(p.lines.map((l) => l.snapshot)),
          q.q,
        ) &&
        (!q.status || p.status === q.status) &&
        (!q.supplier || p.supplierId === q.supplier) &&
        (!q.assignee || p.assigneeId === q.assignee) &&
        (!q.currency || p.currency === q.currency) &&
        (!q.warehouse || p.warehouse === q.warehouse) &&
        (!q.payment || p.paymentStatus === q.payment),
    );
  return paging(selected, q);
}
export async function purchaseDetail(actor: Actor, id: string) {
  await permit(actor, "procurement");
  const db = database();
  const p = await db.purchase.findUniqueOrThrow({
    where: { id },
    include: {
      lines: true,
      receipts: { include: { lines: true } },
      returns: { include: { lines: true } },
      expense: { include: { cash: true } },
      parcels: { include: { lines: true } },
    },
  });
  return {
    ...p,
    lines: p.lines.map((l) => ({ ...l, remaining: remainingPurchase(l) })),
    cash: p.expense ? cashTotals(p.expense.cash) : null,
    expense: p.expense
      ? {
          id: p.expense.id,
          number: p.expense.number,
          amount: p.expense.amount,
          currency: p.expense.currency,
        }
      : null,
    history: await history(db as never, "purchase", id),
    notifications: await db.notification.findMany({
      where: { objectType: "purchase", objectId: id },
      select: { id: true, title: true, status: true, pinned: true },
    }),
  };
}
export async function expenses(actor: Actor, raw: unknown) {
  await permit(actor, "finance");
  const q = querySchema.parse(raw),
    db = database();
  const rows = await db.expense.findMany({
    include: { cash: { include: { correction: true } }, links: true },
    orderBy: { createdAt: "desc" },
  });
  const attachments = await db.businessAttachment.findMany({
    where: { objectType: "expense" },
    select: { objectId: true },
  });
  const inRange = (d: Date | null | undefined, zone: string) =>
    !!d &&
    (!q.from ||
      localDay(d, zone as "Asia/Shanghai" | "Australia/Melbourne") >= q.from) &&
    (!q.to ||
      localDay(d, zone as "Asia/Shanghai" | "Australia/Melbourne") <= q.to);
  const mapped = rows.map((e) => {
    const t = cashTotals(e.cash);
    return {
      ...e,
      ...t,
      outstanding: Math.max(0, e.amount - t.paid),
      paymentStatus: t.refund
        ? "REFUND_RECORDED"
        : !t.paid
          ? e.paymentMode === "PROVIDER_AUTO"
            ? "UNVERIFIED"
            : "UNPAID"
          : t.paid < e.amount
            ? "PART_PAID"
            : "PAID",
    };
  });
  const matched = mapped.filter(
    (e) =>
      contains(e.number + " " + e.title + " " + e.payee, q.q) &&
      (!q.status || e.status === q.status) &&
      (!q.supplier || e.supplierId === q.supplier) &&
      (!q.assignee || e.assigneeId === q.assignee) &&
      (!q.category || e.categoryId === q.category) &&
      (!q.currency || e.currency === q.currency) &&
      (!q.payment || e.paymentStatus === q.payment) &&
      (!q.result || e.resultStatus === q.result) &&
      (q.min === undefined || e.amount >= q.min) &&
      (q.max === undefined || e.amount <= q.max) &&
      (!q.linkedType ||
        (q.linkedType === "purchase"
          ? !!e.purchaseId && (!q.linkedId || e.purchaseId === q.linkedId)
          : q.linkedType === "subscription"
            ? !!e.recurringId && (!q.linkedId || e.recurringId === q.linkedId)
            : e.links.some(
                (l) =>
                  l.objectType === q.linkedType &&
                  (!q.linkedId || l.objectId === q.linkedId),
              ))) &&
      (q.overdue !== "true" ||
        (e.dueAt.toISOString().slice(0, 10) <
          localDay(
            new Date(),
            e.timezone as "Asia/Shanghai" | "Australia/Melbourne",
          ) &&
          e.outstanding > 0)) &&
      (q.failed !== "true" ||
        e.cash.some(
          (c) =>
            c.status === "FAILED" &&
            c.source !== "TEST" &&
            !e.cash.some((x) => x.correctionOf === c.id),
        )) &&
      (q.unfinished !== "true" || e.resultStatus !== "CONFIRMED") &&
      (q.missingEvidence !== "true" ||
        !attachments.some((a) => a.objectId === e.id)) &&
      (!(q.from || q.to) ||
        (q.dateField === "paid"
          ? e.cash.some(
              (c) =>
                c.status === "CONFIRMED" &&
                c.source !== "TEST" &&
                inRange(c.occurredAt, e.timezone),
            )
          : q.dateField === "due"
            ? (!q.from || e.dueAt.toISOString().slice(0, 10) >= q.from) &&
              (!q.to || e.dueAt.toISOString().slice(0, 10) <= q.to)
            : inRange(e.createdAt, e.timezone))),
  );
  if (q.sort === "amount-desc")
    matched.sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  else if (q.sort === "oldest") matched.reverse();
  const summary: Record<
    string,
    {
      obligation: number;
      paid: number;
      refund: number;
      net: number;
      outstanding: number;
      reportObligation: number;
      reportNet: number;
      missingRates: number;
    }
  > = {};
  for (const e of matched) {
    const s = (summary[e.currency] ??= {
      obligation: 0,
      paid: 0,
      refund: 0,
      net: 0,
      outstanding: 0,
      reportObligation: 0,
      reportNet: 0,
      missingRates: 0,
    });
    if (e.status !== "CANCELLED") {
      s.obligation += e.amount;
      s.outstanding += e.outstanding;
      if (e.reportAmount === null) s.missingRates++;
      else s.reportObligation += e.reportAmount;
    }
    for (const c of e.cash) {
      if (
        c.source === "TEST" ||
        c.status !== "CONFIRMED" ||
        ((q.from || q.to) && !inRange(c.occurredAt, e.timezone))
      )
        continue;
      const original = c.kind === "REVERSAL" ? c.correction : c;
      if (!original || original.status !== "CONFIRMED") continue;
      const sign = c.kind === "REVERSAL" ? -1 : 1;
      if (original.kind === "PAYMENT") s.paid += sign * c.amount;
      else if (original.kind === "REFUND") s.refund += sign * c.amount;
      const direction = original.kind === "PAYMENT" ? sign : -sign;
      if (c.reportAmount === null) s.missingRates++;
      else s.reportNet += direction * c.reportAmount;
    }
    s.net = s.paid - s.refund;
  }
  const result = {
    ...paging(
      matched.map(({ cash, links, ...e }) => {
        void cash;
        void links;
        return e;
      }),
      q,
      q.format === "csv",
    ),
    summary,
    reportCurrency: "AUD",
    cashDateBasis:
      "Actual cash occurrence date, in each expense business timezone. TEST records excluded; reversals are signed adjustments at their own occurrence dates. Missing rates are not zero.",
  };
  if (q.format === "csv")
    return csv([
      [
        "Number",
        "Title",
        "Currency",
        "Obligation (minor units)",
        "Paid all time (minor units)",
        "Refund all time (minor units)",
        "Outstanding (minor units)",
        "Payment state",
        "Outcome",
      ],
      ...result.items.map((e) => [
        e.number,
        e.title,
        e.currency,
        e.amount,
        e.paid,
        e.refund,
        e.outstanding,
        e.paymentStatus,
        e.resultStatus,
      ]),
    ]);
  return result;
}
export async function expenseDetail(actor: Actor, id: string) {
  await permit(actor, "finance");
  const db = database();
  const e = await db.expense.findUniqueOrThrow({
    where: { id },
    include: { cash: { orderBy: { occurredAt: "asc" } }, links: true },
  });
  return {
    ...e,
    ...cashTotals(e.cash),
    history: await history(db as never, "expense", id),
    notifications: await db.notification.findMany({
      where: {
        OR: [
          { objectType: "expense", objectId: id },
          ...(e.purchaseId
            ? [{ objectType: "purchase", objectId: e.purchaseId }]
            : []),
        ],
      },
      select: { id: true, title: true, status: true, pinned: true },
    }),
  };
}
export async function recurringList(actor: Actor) {
  await permit(actor, "finance");
  await permit(actor, "recurring");
  return {
    items: (
      await database().recurringExpense.findMany({
        orderBy: { createdAt: "desc" },
      })
    ).map((r) => ({ ...r, nextDue: cycleDate(r, r.nextIndex) })),
  };
}
export async function logistics(actor: Actor, raw: unknown) {
  const q = querySchema.parse(raw);
  const rows = await logisticsList(actor);
  const grace = (
    await database().notificationRuleSettings.findUniqueOrThrow({
      where: { id: "notifications" },
    })
  ).overdueGraceDays;
  const skuNames = await database().productVariant.findMany({
    select: { id: true, sku: true, product: { select: { name: true } } },
  });
  const filtered = rows.filter((r) => {
    const zone = String(r.timezone),
      key =
        q.dateField === "dispatched"
          ? "dispatchedAt"
          : q.dateField === "eta"
            ? "etaEnd"
            : q.dateField === "signed"
              ? "signedAt"
              : q.dateField === "received"
                ? "receivedAt"
                : "createdAt",
      value = r[key] as Date | undefined;
    const names = (r.lines as { variantId: string }[])
      .map((l) => {
        const s = skuNames.find((s) => s.id === l.variantId);
        return s?.sku + " " + s?.product.name;
      })
      .join(" ");
    return (
      contains(
        r.number +
          " " +
          r.businessNumber +
          " " +
          r.reference +
          " " +
          r.trackingNumber +
          " " +
          names,
        q.q,
      ) &&
      (!q.type || r.type === q.type) &&
      (!q.status || r.transportStatus === q.status) &&
      (!q.acceptance || r.acceptanceStatus === q.acceptance) &&
      (!q.warehouse || r.warehouse === q.warehouse) &&
      (!q.sourceWarehouse || r.sourceWarehouse === q.sourceWarehouse) &&
      contains(r.carrier, q.carrier) &&
      (!q.assignee || r.assigneeId === q.assignee) &&
      (!(q.from || q.to) ||
        (!!value &&
          (!q.from ||
            localDay(
              new Date(value),
              zone as "Asia/Shanghai" | "Australia/Melbourne",
            ) >= q.from) &&
          (!q.to ||
            localDay(
              new Date(value),
              zone as "Asia/Shanghai" | "Australia/Melbourne",
            ) <= q.to))) &&
      (q.discrepancy !== "true" || !!r.exception) &&
      (q.overdue !== "true" ||
        (!!r.etaEnd &&
          new Date(new Date(String(r.etaEnd)).getTime() + grace * 86400000)
            .toISOString()
            .slice(0, 10) <
            localDay(
              new Date(),
              zone as "Asia/Shanghai" | "Australia/Melbourne",
            ) &&
          !["RECEIVED", "ACCOUNTED_FOR"].includes(String(r.acceptanceStatus)) &&
          !["LOST", "RETURNED"].includes(String(r.transportStatus)) &&
          (r.type === "SUPPLIER_INBOUND" || r.transportStatus !== "SIGNED")))
    );
  });
  const result = paging(filtered, q, q.format === "csv");
  if (q.format === "csv")
    return csv([
      [
        "Number",
        "Type",
        "Source record",
        "Carrier",
        "Tracking",
        "Transport",
        "Acceptance",
      ],
      ...result.items.map((r) => [
        r.number,
        r.type,
        r.reference,
        r.carrier,
        r.trackingNumber,
        r.transportStatus,
        r.acceptanceStatus,
      ]),
    ]);
  return result;
}
export async function businessDetail(
  actor: Actor,
  resource: string,
  id: string,
) {
  if (resource === "purchases") return purchaseDetail(actor, id);
  if (resource === "expenses") return expenseDetail(actor, id);
  if (resource === "logistics") return parcelDetail(actor, id);
  if (resource === "recurring") {
    await permit(actor, "recurring");
    await permit(actor, "finance");
    const db = database();
    return {
      ...(await db.recurringExpense.findUniqueOrThrow({
        where: { id },
        include: {
          expenses: {
            select: {
              id: true,
              number: true,
              cycle: true,
              amount: true,
              currency: true,
              status: true,
            },
          },
        },
      })),
      history: await history(db as never, "recurring", id),
    };
  }
  if (resource === "suppliers") {
    await permit(actor, "procurement");
    return database().supplier.findUniqueOrThrow({
      where: { id },
      include: {
        sources: true,
        purchases: {
          select: {
            id: true,
            number: true,
            status: true,
            currency: true,
            total: true,
          },
        },
      },
    });
  }
  throw new HttpError(404, "Not found");
}
export async function attachments(actor: Actor, type: string, id: string) {
  await attachmentPermission(actor, type, id);
  return {
    items: await database().businessAttachment.findMany({
      where: { objectType: type, objectId: id },
      select: {
        id: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  };
}
export async function grants(actor: Actor) {
  owner(actor);
  return {
    items: await database().businessGrant.findMany(),
    people: await database().user.findMany({
      where: { active: true },
      select: { id: true, name: true, role: true },
    }),
    capabilities,
  };
}
export async function saveGrant(actor: Actor, input: unknown) {
  owner(actor);
  const v = z
    .object({
      ...base,
      userId: ident,
      capability: z.enum(capabilities),
      enabled: z.boolean(),
    })
    .strict()
    .parse(input);
  return command(actor, "business-grant", v.key, v, async (tx) => {
    const u = await tx.user.findUniqueOrThrow({ where: { id: v.userId } });
    if (!u.active || u.role !== "warehouse")
      throw new HttpError(
        400,
        "Additional business grants apply to an active warehouse account; read-only accounts remain read-only",
      );
    const where = {
      userId_capability: { userId: v.userId, capability: v.capability },
    };
    if (v.enabled)
      await tx.businessGrant.upsert({
        where,
        create: {
          userId: v.userId,
          capability: v.capability,
          grantedBy: actor.id,
        },
        update: { grantedBy: actor.id },
      });
    else
      await tx.businessGrant.deleteMany({
        where: { userId: v.userId, capability: v.capability },
      });
    await audit(
      tx,
      actor,
      "BUSINESS_PERMISSION",
      "user",
      v.userId,
      v.reason,
      undefined,
      { capability: v.capability, enabled: v.enabled },
    );
    return { id: v.userId };
  });
}
