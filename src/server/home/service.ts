import "server-only";
import { database } from "../db";
import { HttpError } from "../errors";
import { staff, type Actor } from "../operations/core";
import { localDay, type NotificationZone } from "../notifications/time";
import { listNotifications } from "../notifications/service";
import { analytics } from "../sales/analytics";
import { filterSchema, orderWhere, compensationWhere } from "../sales/queries";
import { inventoryList, transferList } from "../operations/queries";
import { expenses, logistics } from "../business/queries";
import {
  HOME_VERSION,
  canConfigure,
  catalogue,
  defaultLayout,
  layoutSchema,
  recoverLayout,
  widgetsSchema,
  type HomeMeta,
  type Widget,
  type HomeResult,
  type HomePayload,
  type HomeMetric,
} from "@/lib/home-layout";

export function shiftDay(day: string, delta: number) {
  return new Date(Date.parse(day) + delta * 86400000)
    .toISOString()
    .slice(0, 10);
}
export async function homeActor(input: Actor): Promise<Actor> {
  staff(input);
  const db = database();
  const user = await db.user.findUnique({
    where: { id: input.id },
    select: { active: true, role: true },
  });
  if (!user?.active)
    throw new HttpError(403, "This account is no longer active.");
  const actor = {
    id: input.id,
    role: user.role as Actor["role"],
    capabilities: (
      await db.businessGrant.findMany({ where: { userId: input.id } })
    ).map((g) => g.capability),
  };
  staff(actor);
  return actor;
}
export async function homeMetadata(
  input: Actor,
  now = new Date(),
): Promise<HomeMeta> {
  const actor = await homeActor(input);
  const pref = await database().notificationPreference.findUnique({
    where: { userId: actor.id },
  });
  const timezone: NotificationZone =
    pref?.timezone === "Asia/Shanghai"
      ? "Asia/Shanghai"
      : "Australia/Melbourne";
  const recovered = recoverLayout(
    pref?.homeLayout,
    pref?.homeVersion ?? HOME_VERSION,
    actor,
  );
  return {
    actor,
    timezone,
    today: localDay(now, timezone),
    now: now.toISOString(),
    testWorkspace: new URL(process.env.DATABASE_URL!).pathname.endsWith(
      "_test",
    ),
    version: HOME_VERSION,
    revision: pref?.homeRevision ?? 0,
    ...recovered,
    defaults: defaultLayout(actor),
    catalogue: catalogue(actor),
  };
}
export async function saveHomeLayout(input: Actor, raw: unknown) {
  const actor = await homeActor(input),
    data = layoutSchema.parse(raw);
  if (data.widgets.some((w) => !canConfigure(actor, w)))
    throw new HttpError(
      403,
      "A widget or configuration is outside your current permissions.",
    );
  await database().$transaction(async (tx) => {
    await tx.notificationPreference.upsert({
      where: { userId: actor.id },
      create: { userId: actor.id },
      update: {},
    });
    const saved = await tx.notificationPreference.updateMany({
      where: { userId: actor.id, homeRevision: data.revision },
      data: {
        homeVersion: HOME_VERSION,
        homeLayout: data.widgets,
        homeRevision: { increment: 1 },
      },
    });
    if (!saved.count)
      throw new HttpError(
        409,
        "Your layout was saved in another tab. Cancel editing to load that version before saving again.",
      );
  });
  return homeMetadata(actor);
}
const href = (
  area: string,
  section: string,
  query: Record<string, string> = {},
) => `/admin/${area}?${new URLSearchParams({ section, ...query })}`;
const metric = (
  key: string,
  label: string,
  value: number | null,
  link: string,
  unit = "",
): HomeMetric => ({ key, label, value, href: link, unit });

export async function homeData(input: Actor, raw: unknown, now = new Date()) {
  const meta = await homeMetadata(input, now),
    actor = meta.actor as Actor;
  const widgets = widgetsSchema.parse(raw);
  if (widgets.some((w) => !canConfigure(actor, w)))
    throw new HttpError(
      403,
      "A requested widget is outside your current permissions.",
    );
  const { today, timezone } = meta;
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    if (!memo.has(key)) memo.set(key, run());
    return memo.get(key) as Promise<T>;
  };
  const stats = () =>
    once("sales", async () => {
      const result = await analytics(actor, {
        from: shiftDay(today, -6),
        to: today,
        asOf: today,
        timezone,
        dataKind: "REAL",
        bucket: "day",
      });
      if (typeof result === "string") throw new Error("Unexpected export");
      return result;
    });
  const statsLink = (day: string, from = day) =>
    href("sales", "analytics", {
      from,
      to: day,
      asOf: today,
      timezone,
      dataKind: "REAL",
      bucket: "day",
    });
  const stock = (warehouse: string) =>
    once(`stock:${warehouse}`, () =>
      inventoryList(actor, { warehouse, active: "true" }, true),
    );
  const notices = (query: Record<string, string>) =>
    once("notifications:" + JSON.stringify(query), () =>
      listNotifications(actor, { ...query, dataKind: "REAL" }),
    );
  const queryExpenses = async (query: Record<string, string>) => {
    const data = await expenses(
      actor,
      { ...query, dataKind: "REAL", pageSize: 1 },
      memo,
    );
    if (typeof data === "string") throw new Error("Unexpected export");
    return data;
  };
  const queryLogistics = async (query: Record<string, string>) => {
    const data = await logistics(
      actor,
      { ...query, dataKind: "REAL", source: "PARCEL", pageSize: 1 },
      memo,
    );
    if (typeof data === "string") throw new Error("Unexpected export");
    return data;
  };
  const resolve = async (w: Widget): Promise<HomePayload> => {
    if (w.type === "sales" || w.type === "trend") {
      const report = await stats();
      const point = report.trend.find((p) => p.period === today);
      const note =
        "AUD merchandise after discounts, before refunds. Shipping excluded; tax is not separately collected. Recorded REAL payment successes only; TEST, simulated and unverified payments excluded.";
      const missingEvents = await once("missing-payment-history", () =>
        database().shopOrder.count({
          where: {
            dataKind: "REAL",
            paymentStatus: "PAID",
            events: {
              none: {
                type: "PAYMENT_SUCCEEDED",
                dataKind: "REAL",
                occurredAt: { not: null },
              },
            },
          },
        }),
      );
      const missing = [
        report.unknownHistoricalPaidOrders
          ? `${report.unknownHistoricalPaidOrders} historical paid order(s) have unknown provenance`
          : "",
        missingEvents
          ? `${missingEvents} REAL paid order(s) lack a dated payment-success event`
          : "",
      ].filter(Boolean);
      const incomplete = missing.length
        ? `${missing.join("; ")}. These incomplete records are excluded.`
        : undefined;
      if (w.type === "sales")
        return {
          metrics: [
            {
              ...metric(
                "merchandise",
                "Paid merchandise",
                point?.merchandise ?? null,
                statsLink(today),
              ),
              currency: "AUD",
            },
            metric(
              "orders",
              "Successful payment orders",
              point?.orders ?? null,
              statsLink(today),
              "orders",
            ),
          ],
          note,
          incomplete,
          empty: !point?.orders
            ? "No recorded successful payments today. This is not an estimate of missing history."
            : undefined,
        };
      return {
        metrics: [
          {
            ...metric(
              "total",
              "Recorded merchandise · 7 days",
              report.totals.orders ? report.totals.merchandise : null,
              statsLink(today, shiftDay(today, -6)),
            ),
            currency: "AUD",
          },
        ],
        trend: Array.from({ length: 7 }, (_, i) => {
          const day = shiftDay(today, i - 6),
            p = report.trend.find((p) => p.period === day);
          return {
            day,
            value: p?.orders ? p.merchandise : null,
            orders: p?.orders ?? 0,
            href: statsLink(day),
          };
        }),
        note: `${note} Includes today, which is still in progress. Gaps mean no recorded payments, not confirmed zero sales.`,
        incomplete,
        empty: report.totals.orders
          ? undefined
          : "No payment history in this period. No sample curve is shown.",
      };
    }
    if (w.type === "dispatch") {
      const base = {
        payment: "PAID",
        fulfillment: "UNFULFILLED",
        dataKind: "REAL",
        verified: "true",
      };
      const [all, overdue] = await Promise.all(
        [{}, { exception: "shipment" }].map(async (extra) =>
          database().shopOrder.count({
            where: await orderWhere(
              actor,
              filterSchema.parse({ ...base, ...extra }),
            ),
          }),
        ),
      );
      return {
        metrics: [
          metric(
            "waiting",
            "Awaiting dispatch",
            all,
            href("sales", "orders", base),
            "orders",
          ),
          {
            ...metric(
              "overdue",
              "Overdue dispatch",
              overdue,
              href("sales", "orders", { ...base, exception: "shipment" }),
              "orders",
            ),
            attention: overdue > 0,
          },
        ],
        note: "Current total, regardless of creation date. Recorded REAL payments; unfulfilled orders only. Overdue uses existing active shipment timers and pause rules.",
      };
    }
    if (w.type === "inventory") {
      const warehouses =
        w.config.warehouse === "BOTH"
          ? ["MELBOURNE", "BEIJING"]
          : [w.config.warehouse];
      const metrics = (
        await Promise.all(
          warehouses.map(async (warehouse) => {
            const rows = (await stock(warehouse)).items;
            const available = (r: (typeof rows)[number]) =>
              warehouse === "BEIJING"
                ? (r.beijing?.available ?? 0)
                : r.melbourne.available;
            const base = { warehouse, active: "true" };
            const name = warehouse === "BEIJING" ? "Beijing" : "Melbourne";
            const low = rows.filter(
                (r) =>
                  r.lowStockThreshold !== null &&
                  available(r) <= r.lowStockThreshold,
              ).length,
              zero = rows.filter((r) => available(r) === 0).length;
            return [
              {
                ...metric(
                  warehouse + "-low",
                  name + " · low stock",
                  low,
                  href("operations", "inventory", { ...base, low: "true" }),
                  "SKUs",
                ),
                attention: low > 0,
              },
              {
                ...metric(
                  warehouse + "-zero",
                  name + " · zero available",
                  zero,
                  href("operations", "inventory", { ...base, zero: "true" }),
                  "SKUs",
                ),
                attention: zero > 0,
              },
            ];
          }),
        )
      ).flat();
      return {
        metrics,
        note: "Enabled SKUs on non-archived products. Low stock uses Stock’s saved thresholds. Zero available includes SKUs whose alert is off; these are separate, overlapping counts.",
      };
    }
    if (w.type === "notifications") {
      const data = await notices({ view: "today", day: today });
      const items = data.items.slice(0, w.size === "large" ? 6 : 3);
      return {
        metrics: [],
        notifications: {
          items: items.map((n) => ({
            id: n.id,
            title: n.title,
            reason: n.reason,
            type: n.type,
            severity: n.severity,
            createdAt: n.createdAt.toISOString(),
            pinned: n.pinned,
            assignee: n.assigneeName,
            confirmed: n.confirmed,
            required: n.confirmerIds.length,
          })),
          total: data.total,
          hiddenPinned: data.pinnedTotal - items.filter((n) => n.pinned).length,
          href: `/admin/notifications?${new URLSearchParams({ view: "today", day: today, dataKind: "REAL" })}`,
        },
        note: "Pinned first. First generated today, plus still-pinned earlier items; each appears once. Acknowledgement does not resolve an issue.",
        empty: data.total
          ? undefined
          : "No notifications today or earlier pinned items in your permitted scope.",
      };
    }
    if (w.type === "logistics") {
      const base: Record<string, string> =
        w.config.type === "ALL" ? {} : { type: w.config.type };
      const qs: Record<string, string>[] = [
        { ...base, inTransit: "true" },
        {
          ...base,
          awaitingArrival: "true",
          dateField: "eta",
          from: today,
          to: today,
        },
        { ...base, overdue: "true" },
      ];
      const [all, ...results] = await Promise.all([
        queryLogistics(base),
        ...qs.map(queryLogistics),
      ]);
      return {
        metrics: results.map((r, i) => ({
          ...metric(
            ["transit", "due", "overdue"][i],
            ["In transit", "ETA ends today", "Unresolved overdue"][i],
            all.total ? r.total : null,
            href("business", "logistics", {
              ...qs[i],
              source: "PARCEL",
              dataKind: "REAL",
            }),
            "parcel records",
          ),
          attention: i === 2 && r.total > 0,
        })),
        note: "Counts parcel records, not boxes or linked business summaries. In transit = dispatched / in transit. ETA uses the recorded end date; overdue keeps existing grace, acceptance and business-timezone rules.",
        empty: all.total
          ? undefined
          : "No permitted parcel records. Transfer/order summaries are not counted as parcels.",
      };
    }
    if (w.type === "expenses") {
      const qs = [
        { pending: "true", dateField: "due", from: today, to: today },
        {
          pending: "true",
          dateField: "due",
          from: shiftDay(today, 1),
          to: shiftDay(today, 7),
        },
      ];
      const [due, next, exceptions] = await Promise.all([
        queryExpenses(qs[0]),
        queryExpenses(qs[1]),
        queryExpenses({ exception: "true" }),
      ]);
      const metrics: HomeMetric[] = [due, next].flatMap<HomeMetric>((result, i) => {
        const label = i ? "Next 7 days · outstanding" : "Today · outstanding";
        const currencies = Object.entries(result.summary);
        return currencies.length
          ? currencies.map(([currency, values]) => ({
              ...metric(
                `${i}-${currency}`,
                label,
                values.outstanding,
                href("business", "expenses", {
                  ...qs[i],
                  dataKind: "REAL",
                  currency,
                }),
              ),
              currency,
            }))
          : [
              {
                ...metric(
                  `${i}-empty`,
                  label,
                  null,
                  href("business", "expenses", { ...qs[i], dataKind: "REAL" }),
                ),
                emptyLabel: "Nothing due",
              },
            ];
      });
      metrics.push({
        ...metric(
          "exceptions",
          "Expenses with unresolved alerts",
          exceptions.total,
          href("business", "expenses", { exception: "true", dataKind: "REAL" }),
          "expenses",
        ),
        attention: exceptions.total > 0,
      });
      return {
        metrics,
        note: `Due dates are stored calendar dates. Today = ${today} in ${timezone}. Next 7 days = ${shiftDay(today, 1)}–${shiftDay(today, 7)}, excluding today. Open obligations less confirmed non-test payments; currencies are separate, with no conversion.`,
        empty:
          !due.total && !next.total
            ? "No open outstanding expenses due today or in the next 7 days."
            : undefined,
      };
    }
    if (w.type === "receiving") {
      const result = await transferList(actor, { awaitingReceipt: "true" });
      return {
        metrics: [
          metric(
            "transfers",
            "Incoming transfers to accept",
            result.total,
            href("operations", "transfers", { awaitingReceipt: "true" }),
            "transfer records",
          ),
        ],
        note: "Sent or partially received Beijing → Melbourne transfers with remaining quantities. Counts transfers, not packages.",
      };
    }
    if (w.type === "replacement") {
      const query = { pendingReplacement: "true", dataKind: "REAL" };
      const count = await database().compensation.count({
        where: compensationWhere(actor, query),
      });
      return {
        metrics: [
          metric(
            "replacement",
            "Replacement dispatch pending",
            count,
            href("sales", "compensations", query),
            "requests",
          ),
        ],
        note: "Approved, executing or failed replacement requests that are not shipped. Only your existing case scope and REAL orders; approval/execution permissions are unchanged.",
      };
    }
    const rows = (await stock("MELBOURNE")).items;
    return {
      metrics: [
        metric(
          "discrepancy",
          "Receipt / count discrepancies",
          rows.filter((r) => r.discrepancy).length,
          href("operations", "inventory", {
            warehouse: "MELBOURNE",
            active: "true",
            discrepancy: "true",
          }),
          "SKUs",
        ),
        metric(
          "counts",
          "SKUs awaiting count review",
          rows.filter((r) => r.pendingCounts > 0).length,
          href("operations", "inventory", {
            warehouse: "MELBOURNE",
            active: "true",
            pendingCounts: "true",
          }),
          "SKUs",
        ),
      ],
      note: "Enabled SKUs on non-archived products, using existing Stock discrepancy and pending-count flags. Recorded receipt discrepancies may remain visible after handling.",
    };
  };
  const results = await settleHomeWidgets(widgets, (widget) =>
    once(
      "widget:" + JSON.stringify([widget.type, widget.config, widget.size]),
      () => resolve(widget),
    ),
  );
  return { meta, results };
}
export async function settleHomeWidgets(
  widgets: Widget[],
  resolve: (widget: Widget) => Promise<HomePayload>,
): Promise<HomeResult[]> {
  return Promise.all(
    widgets.map(async (widget) => {
      try {
        const data = await resolve(widget);
        return {
          id: widget.id,
          data,
          status: data.incomplete
            ? ("incomplete" as const)
            : data.empty
              ? ("empty" as const)
              : ("success" as const),
          updatedAt: new Date().toISOString(),
        };
      } catch (error) {
        console.error("Home widget unavailable", {
          type: widget.type,
          error: error instanceof Error ? error.name : "Unknown",
        });
        return {
          id: widget.id,
          status:
            error instanceof HttpError && error.status === 403
              ? ("forbidden" as const)
              : ("error" as const),
          error:
            error instanceof HttpError
              ? error.message
              : "This widget could not be updated. Retry when the local service is available.",
        };
      }
    }),
  );
}
