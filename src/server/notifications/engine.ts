import "server-only";
import { generateRecurring } from "../business/recurring";
import { businessIssues } from "../business/notifications";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { database } from "../db";
import { type Tx, type Actor, owner } from "../operations/core";
import { remaining } from "../operations/transfers";
import { localDay, dateBounds } from "./time";
import { routing, effectiveThreshold } from "./rules";
import { validatePeople } from "./access";
import { HttpError } from "../errors";
export type Issue = {
  key: string;
  type:
    | "INVENTORY"
    | "PRODUCT"
    | "LOGISTICS"
    | "SYSTEM"
    | "PROCUREMENT"
    | "FINANCE";
  severity: number;
  title: string;
  reason: string;
  action: string;
  objectType: string;
  objectId: string;
  warehouse?: "BEIJING" | "MELBOURNE";
  data: Prisma.InputJsonObject;
  material: unknown;
  pin?: boolean;
  actionable?: boolean;
  occurredAt?: Date;
  deadlineAt?: Date | null;
  initiatorId?: string;
};
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
async function history(
  tx: Tx,
  id: string,
  action: string,
  reason: string,
  data: unknown,
) {
  await tx.notificationHistory.create({
    data: {
      notificationId: id,
      actorId: "system",
      action,
      reason,
      data: json(data),
    },
  });
}
async function check(tx: Tx) {
  const rules = await tx.notificationRuleSettings.findUniqueOrThrow({
    where: { id: "notifications" },
  });
  const routes = routing.parse(rules.routing);
  const owners = await tx.user.findMany({
    where: { role: "admin", active: true },
    select: { id: true },
  });
  await generateRecurring(tx);
  const issues: Issue[] = await businessIssues(tx, rules.overdueGraceDays);
  const policies = await tx.stockAlertPolicy.findMany();
  const skus = await tx.productVariant.findMany({
    include: {
      product: true,
      balances: true,
      transferLines: { include: { transfer: true } },
    },
  });
  for (const s of skus) {
    if (!s.enabled || s.product.status === "ARCHIVED") continue;
    const qty = (w: string) => {
      const b = s.balances.find((b) => b.warehouse === w);
      return b ? b.onHand - b.reserved - b.unavailable : 0;
    };
    const bj = qty("BEIJING"),
      mel = qty("MELBOURNE");
    const transit = s.transferLines.filter(
      (l) =>
        ["SENT", "PARTIAL"].includes(l.transfer.status) &&
        !l.transfer.exception &&
        remaining(l) > 0,
    );
    const incoming = transit.reduce((n, l) => n + remaining(l), 0);
    for (const warehouse of ["BEIJING", "MELBOURNE"] as const) {
      const policy = policies.find(
        (p) => p.variantId === s.id && p.warehouse === warehouse,
      );
      const threshold = effectiveThreshold(
        policy,
        warehouse === "BEIJING"
          ? rules.beijingThreshold
          : rules.melbourneThreshold,
      );
      if (threshold === null || qty(warehouse) > threshold) continue;
      const empty = bj === 0 && mel === 0 && incoming === 0;
      const gap = Math.max(0, threshold + 1 - qty(warehouse));
      const suggestion =
        warehouse === "BEIJING"
          ? "Contact the supplier to replenish Beijing."
          : incoming >= gap
            ? "Follow the existing incoming transfer; do not duplicate replenishment."
            : bj > 0
              ? "Create or review a Beijing to Melbourne transfer."
              : "Contact the supplier about replenishment; no purchase orders are tracked.";
      const data = {
        sku: s.sku,
        name: s.product.name,
        warehouse,
        available: qty(warehouse),
        threshold,
        source: policy?.mode === "CUSTOM" ? "CUSTOM" : "WAREHOUSE_DEFAULT",
        beijingAvailable: bj,
        inTransit: incoming,
        eta: transit.map((l) => ({
          transferId: l.transferId,
          end: l.transfer.etaEnd?.toISOString() ?? null,
          remaining: remaining(l),
        })),
        gapToAboveThreshold: gap,
        gapMeaning:
          "Arithmetic gap only, not an optimal purchase recommendation",
      };
      issues.push({
        key: `stock:${warehouse}:${s.id}`,
        type: "INVENTORY",
        severity: empty ? 2 : 1,
        title: `${s.sku}: ${warehouse} low stock`,
        reason: `Available ${qty(warehouse)} is at or below threshold ${threshold}.`,
        action: suggestion,
        objectType: "sku",
        objectId: s.id,
        warehouse,
        data,
        material: {
          empty,
          suggestion,
          threshold,
          available: qty(warehouse),
          incoming,
          eta: data.eta,
        },
        pin: empty && rules.autoPinOutOfStock,
      });
    }
  }
  const products = await tx.product.findMany({
    include: { images: true, variants: true, category: true },
  });
  const pp = await tx.productCheckPolicy.findMany();
  const missing: { id: string; name: string; missing: string[] }[] = [];
  if (rules.productEnabled)
    for (const p of products) {
      const mode = pp.find((x) => x.productId === p.id)?.mode || "INHERIT";
      const enabled =
        mode === "ON" ||
        (mode === "INHERIT" &&
          rules.productNewDefault &&
          !!rules.productExistingSince &&
          p.createdAt >= rules.productExistingSince);
      if (!enabled || p.status === "ARCHIVED") continue;
      const fields: string[] = [];
      if (!p.images.length)
        fields.push("Product image (required for publishing)");
      if (!p.name.trim()) fields.push("Name (required)");
      if (!p.category.active) fields.push("Active category");
      if (!p.description.trim())
        fields.push(
          "Description including material and applicable fit information (recommended)",
        );
      if (!p.variants.some((v) => v.enabled && v.priceCents > 0))
        fields.push("Enabled SKU with valid price (required)");
      if (
        p.category.slug === "rings" &&
        !p.variants.some((v) => v.size.trim()) &&
        !p.description.trim()
      )
        fields.push("Ring size / fit information (recommended)");
      if (fields.length)
        missing.push({ id: p.id, name: p.name, missing: fields });
    }
  if (missing.length)
    issues.push({
      key: "product-quality-summary",
      type: "PRODUCT",
      severity: 1,
      title: `${missing.length} products need information`,
      reason:
        "Grouped product information check; required publishing validation remains independent.",
      action:
        "Open Catalogue, review the per-product missing information and save corrections.",
      objectType: "products",
      objectId: "summary",
      data: { products: missing },
      material: missing,
    });
  const transfers = await tx.transfer.findMany({
    include: { lines: true, receipts: { include: { lines: true } } },
  });
  const today = localDay(new Date(), "Australia/Melbourne");
  for (const t of transfers) {
    const pending = t.lines.reduce((n, l) => n + remaining(l), 0);
    if (["SENT", "PARTIAL"].includes(t.status) && pending > 0) {
      const end = t.etaEnd?.toISOString().slice(0, 10);
      const due = end
        ? new Date(Date.parse(end) + rules.overdueGraceDays * 86400000)
            .toISOString()
            .slice(0, 10)
        : null;
      if (!end || due! < today)
        issues.push({
          key: `transit:${t.id}:${end ? "overdue" : "missing-eta"}`,
          type: "LOGISTICS",
          severity: end ? 2 : 1,
          title: `${t.number}: ${end ? "receipt not registered by expected date" : "expected arrival needs updating"}`,
          reason: end
            ? "The expected arrival window and grace period have passed; receipt is not fully registered. This does not prove the parcel has not arrived."
            : "No destination arrival end date has been recorded.",
          action:
            "Check with Melbourne, record actual receipts or revise ETA with a reason.",
          objectType: "transfer",
          objectId: t.id,
          data: {
            number: t.number,
            pending,
            etaStart: t.etaStart?.toISOString() ?? null,
            etaEnd: t.etaEnd?.toISOString() ?? null,
          },
          material: { pending, end, due },
          pin: true,
          deadlineAt: due
            ? new Date(dateBounds(due, "Australia/Melbourne").lt.getTime() - 1)
            : null,
        });
    }
    const damage = t.lines.reduce((n, l) => n + l.receivedUnavailable, 0),
      loss = t.lines.reduce((n, l) => n + l.lost, 0);
    if (damage || loss || t.exception)
      issues.push({
        key: `damage:${t.id}`,
        type: "LOGISTICS",
        severity: 2,
        title: `${t.number}: receipt / transport exception`,
        reason:
          "Damage, confirmed transit loss or an explicitly recorded transport exception requires a recorded outcome. Partial receipt alone is not a shortage.",
        action:
          "Investigate the related receipt records and record the outcome before resolving.",
        objectType: "transfer",
        objectId: t.id,
        data: {
          number: t.number,
          unavailableReceived: damage,
          confirmedLost: loss,
          exception: t.exception,
        },
        material: { damage, loss, exception: t.exception },
        pin: true,
      });
  }
  const events = await tx.auditLog.findMany({
    where: {
      action: {
        in: [
          "TRANSFER_SENT",
          "TRANSFER_UPDATED",
          "TRANSFER_RECEIPT",
          "TRANSFER_RETURNED",
        ],
      },
      createdAt: { gte: rules.installedAt },
    },
    orderBy: { createdAt: "asc" },
  });
  for (const e of events) {
    const t = transfers.find((t) => t.id === e.objectId);
    if (!t) continue;
    const recorded =
      e.after && typeof e.after === "object" && !Array.isArray(e.after)
        ? e.after
        : {};
    const eventLabel =
      e.action === "TRANSFER_RECEIPT"
        ? recorded.status === "CLOSED"
          ? "warehouse receipt completed"
          : `partial warehouse receipt · ${recorded.remaining ?? "see record for"} remaining`
        : e.action.replaceAll("_", " ").toLowerCase();
    issues.push({
      key: `event:${e.id}`,
      type: "LOGISTICS",
      severity: 0,
      title: `${t.number}: ${eventLabel}`,
      reason: e.reason,
      action:
        "Review the registered transfer or receipt record. These are manually entered records, not carrier tracking.",
      objectType: "transfer",
      objectId: t.id,
      data: {
        event: e.action,
        recorded: e.after ?? {},
        previous: e.before ?? {},
      },
      material: { event: e.id },
      actionable: false,
      occurredAt: e.createdAt,
      initiatorId: e.actorId ?? undefined,
    });
  }
  const active = new Set(issues.map((i) => i.key));
  for (const i of issues) {
    const old = await tx.notification.findFirst({
      where: { issueKey: i.key, conditionActive: true },
    });
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ data: i.material, autoPin: !!i.pin }))
      .digest("hex");
    if (old) {
      if (old.fingerprint !== fingerprint) {
        const version = old.version + 1;
        const reopen = old.status;
        await tx.notification.update({
          where: { id: old.id },
          data: {
            version,
            fingerprint,
            ruleVersion: rules.version,
            ruleSnapshot: json(rules),
            title: i.title,
            reason: i.reason,
            action: i.action,
            currentData: json(i.data),
            severity: i.severity,
            ...(i.pin
              ? {
                  pinned: true,
                  systemPin: true,
                  pinReason: "System exception rule",
                }
              : {}),
            deadlineAt: i.deadlineAt,
            status: reopen,
          },
        });
        await tx.notificationRevision.create({
          data: {
            notificationId: old.id,
            version,
            snapshot: json(i.data),
            confirmerIds: old.confirmerIds,
            reason:
              "Material quantity, due-date or action change; confirmation required again.",
          },
        });
        await history(
          tx,
          old.id,
          "REVISION",
          "Material business data changed",
          { version },
        );
      } else if (
        old.title !== i.title ||
        old.reason !== i.reason ||
        JSON.stringify(old.currentData) !== JSON.stringify(i.data)
      ) {
        // Cosmetic changes keep the same confirmation version.
        await tx.notification.update({
          where: { id: old.id },
          data: {
            title: i.title,
            reason: i.reason,
            action: i.action,
            currentData: json(i.data),
          },
        });
      }
      continue;
    }
    const last = await tx.notification.findFirst({
      where: { issueKey: i.key },
      orderBy: { cycle: "desc" },
    });
    let route = routes[i.type];
    if (!route) {
      if (owners.length !== 1)
        throw new HttpError(
          409,
          "Choose default owners and confirmers in notification rules; a unique active owner is required for automatic defaults.",
        );
      route = {
        assigneeId: owners[0].id,
        recipientIds: [owners[0].id],
        confirmerIds: [owners[0].id],
      };
    }
    // A shared logistics route may include Melbourne staff; Beijing parcel details remain owner-only.
    if (i.warehouse === "BEIJING" && i.type === "LOGISTICS") {
      const eligible = await tx.user.findMany({
        where: { active: true, role: "admin" },
        select: { id: true },
      });
      const ids = new Set(eligible.map((u) => u.id));
      const recipients = route.recipientIds.filter((id) => ids.has(id)),
        confirmers = route.confirmerIds.filter((id) => ids.has(id));
      if (!eligible.length)
        throw new HttpError(
          409,
          "An active owner is required for Beijing logistics",
        );
      route = {
        assigneeId: ids.has(route.assigneeId)
          ? route.assigneeId
          : eligible[0].id,
        recipientIds: recipients.length ? recipients : [eligible[0].id],
        confirmerIds: confirmers.length ? confirmers : [eligible[0].id],
      };
    }
    await validatePeople(tx, i.type, i.warehouse ?? null, [
      route.assigneeId,
      ...route.recipientIds,
      ...route.confirmerIds,
    ]);
    const n = await tx.notification.create({
      data: {
        issueKey: i.key,
        cycle: (last?.cycle ?? 0) + 1,
        type: i.type,
        severity: i.severity,
        title: i.title,
        reason: i.reason,
        action: i.action,
        objectType: i.objectType,
        objectId: i.objectId,
        warehouse: i.warehouse,
        status: i.actionable === false ? "RESOLVED" : "OPEN",
        actionable: i.actionable !== false,
        pinned: !!i.pin,
        systemPin: !!i.pin,
        pinReason: i.pin ? "System exception rule" : "",
        assigneeId: route.assigneeId,
        recipientIds: [
          ...new Set([
            ...route.recipientIds,
            ...route.confirmerIds,
            route.assigneeId,
          ]),
        ],
        confirmerIds: route.confirmerIds,
        fingerprint,
        rule: i.key.split(":")[0],
        ruleVersion: rules.version,
        ruleSnapshot: json(rules),
        snapshot: json(i.data),
        currentData: json(i.data),
        occurredAt: i.occurredAt ?? new Date(),
        deadlineAt: i.deadlineAt,
        initiatorId: i.initiatorId ?? "system",
      },
    });
    await tx.notificationRevision.create({
      data: {
        notificationId: n.id,
        version: 1,
        snapshot: json(i.data),
        confirmerIds: n.confirmerIds,
        reason: "First trigger",
      },
    });
    await history(tx, n.id, "CREATED", "Rule triggered", {
      ruleVersion: rules.version,
    });
  }
  const stale = await tx.notification.findMany({
    where: { conditionActive: true },
  });
  for (const n of stale)
    if (!active.has(n.issueKey) && !n.issueKey.startsWith("event:")) {
      let resolution =
        "Condition recovered or no longer eligible; prior history retained.";
      if (n.rule === "stock") {
        const threshold = effectiveThreshold(
          policies.find(
            (p) => p.variantId === n.objectId && p.warehouse === n.warehouse,
          ),
          n.warehouse === "BEIJING"
            ? rules.beijingThreshold
            : rules.melbourneThreshold,
        );
        resolution =
          threshold === null
            ? "Stock alert rule disabled; this cycle is closed."
            : "Available stock recovered above threshold or SKU is no longer eligible.";
      } else if (n.rule === "transit") {
        const transfer = transfers.find((t) => t.id === n.objectId);
        resolution =
          transfer && transfer.lines.every((l) => remaining(l) === 0)
            ? "Remaining dispatched quantity has been fully accounted for."
            : "Expected arrival revised or transfer no longer eligible; previous overdue history retained.";
      } else if (n.type === "PRODUCT")
        resolution = rules.productEnabled
          ? "Product information completed or checking scope changed."
          : "Product information checks disabled.";
      await tx.notification.update({
        where: { id: n.id },
        data: {
          conditionActive: false,
          status: "RESOLVED",
          currentData: {
            lastIssueData: json(n.currentData),
            conditionActive: false,
            resolution,
          },
        },
      });
      await history(tx, n.id, "AUTO_RESOLVED", resolution, {});
    }
  return issues.length;
}
export async function runNotificationCheck(actor?: Actor, force = false) {
  if (actor) owner(actor);
  const db = database();
  const startedAt = new Date();
  try {
    return await db.$transaction(
      async (tx) => {
        const lock = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(hashtextextended('notification-scan',0)) AS locked`;
        if (!lock[0].locked) return { busy: true };
        const state = await tx.notificationJob.findUniqueOrThrow({
          where: { id: "notifications" },
        });
        if (
          actor &&
          state.lastStartedAt &&
          Date.now() - state.lastStartedAt.getTime() < 10000
        )
          throw new HttpError(
            429,
            "A check just ran; wait a few seconds before retrying.",
          );
        if (
          !force &&
          state.requested === state.completed &&
          state.lastSuccessAt &&
          Date.now() - state.lastSuccessAt.getTime() < 60000
        )
          return { skipped: true };
        await tx.notificationJob.update({
          where: { id: state.id },
          data: { lastStartedAt: startedAt, attempts: { increment: 1 } },
        });
        const checked = await check(tx);
        await tx.notificationJob.update({
          where: { id: state.id },
          data: {
            completed: state.requested,
            lastSuccessAt: new Date(),
            lastError: null,
          },
        });
        await tx.notificationJobRun.create({
          data: { startedAt, success: true, checked },
        });
        return { checked };
      },
      { timeout: 60000, maxWait: 10000 },
    );
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) throw e;
    const error =
      e instanceof HttpError
        ? e.message
        : "Notification check failed. Review local database and rule configuration; no private payload was logged.";
    await db.notificationJob
      .update({
        where: { id: "notifications" },
        data: { lastError: error, lastErrorAt: new Date() },
      })
      .catch(() => {});
    await db.notificationJobRun
      .create({ data: { startedAt, success: false, error } })
      .catch(() => {});
    throw new HttpError(503, error);
  }
}
