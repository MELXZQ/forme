import "server-only";
import { createHash } from "node:crypto";
import { database } from "../db";
import { command, owner, audit, type Actor } from "../operations/core";
import { inventoryList } from "../operations/queries";
import { HttpError } from "../errors";
import { rulesSchema, stockSchema, productSchema, routing } from "./validation";
import { validatePeople } from "./access";
export async function settings(actor: Actor) {
  owner(actor);
  const db = database();
  const [rules, people, job, runs] = await Promise.all([
    db.notificationRuleSettings.findUniqueOrThrow({
      where: { id: "notifications" },
    }),
    db.user.findMany({
      where: { active: true, role: { in: ["admin", "warehouse", "viewer"] } },
      select: { id: true, name: true, role: true },
    }),
    db.notificationJob.findUnique({ where: { id: "notifications" } }),
    db.notificationJobRun.findMany({
      take: 20,
      orderBy: { finishedAt: "desc" },
    }),
  ]);
  const busy = await db.$queryRaw<{ running: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND granted AND objsubid = 1
      AND classid = ((hashtextextended('notification-scan',0) >> 32) & 4294967295)::oid
      AND objid = (hashtextextended('notification-scan',0) & 4294967295)::oid) AS running`;
  return {
    rules,
    people,
    job: job
      ? {
          ...job,
          requested: String(job.requested),
          completed: String(job.completed),
          state: busy[0].running
            ? "Running"
            : job.lastError
              ? "Failed — retry needed"
              : !job.lastSuccessAt ||
                  Date.now() - job.lastSuccessAt.getTime() > 180000
                ? "No recent check — start the local task"
                : job.requested !== job.completed
                  ? "Changes pending"
                  : "Up to date",
        }
      : null,
    runs,
  };
}
export async function saveRules(actor: Actor, input: unknown) {
  owner(actor);
  const v = rulesSchema.parse(input);
  return command(actor, "notification-rules", v.key, v, async (tx) => {
    const old = await tx.notificationRuleSettings.findUniqueOrThrow({
      where: { id: "notifications" },
    });
    for (const [type, r] of Object.entries(v.routing))
      if (r)
        await validatePeople(
          tx,
          type,
          type === "INVENTORY" ? "BEIJING" : null,
          [r.assigneeId, ...r.recipientIds, ...r.confirmerIds],
        );
    const after = await tx.notificationRuleSettings.update({
      where: { id: old.id },
      data: {
        version: { increment: 1 },
        beijingThreshold: v.beijingThreshold,
        melbourneThreshold: v.melbourneThreshold,
        productEnabled: v.productEnabled,
        productNewDefault: v.productNewDefault,
        productExistingSince:
          v.productScope === "EXISTING"
            ? new Date(0)
            : (old.productExistingSince ??
              (v.productEnabled ? new Date() : null)),
        overdueGraceDays: v.overdueGraceDays,
        autoPinOutOfStock: v.autoPinOutOfStock,
        routing: v.routing,
      },
    });
    if (v.productEnabled && v.productScope === "EXISTING") {
      const products = await tx.product.findMany({ select: { id: true } });
      for (const p of products) {
        const policy = await tx.productCheckPolicy.findUnique({
          where: { productId: p.id },
        });
        if (!policy || policy.mode === "INHERIT")
          await tx.productCheckPolicy.upsert({
            where: { productId: p.id },
            create: { productId: p.id, mode: "ON" },
            update: { mode: "ON" },
          });
      }
    }
    await audit(
      tx,
      actor,
      "NOTIFICATION_RULES",
      "settings",
      old.id,
      v.reason,
      old,
      after,
    );
    return { id: old.id };
  });
}
export function effectiveThreshold(
  policy: { mode: string; threshold: number | null } | undefined,
  defaultValue: number | null,
) {
  if (policy?.mode === "OFF") return null;
  if (policy?.mode === "CUSTOM") return policy.threshold;
  return defaultValue;
}
export async function stockPreview(
  actor: Actor,
  input: {
    warehouse: string;
    ids?: string[];
    filters?: Record<string, string>;
  },
) {
  owner(actor);
  if (!["BEIJING", "MELBOURNE"].includes(input.warehouse))
    throw new HttpError(400, "Choose a warehouse.");
  const available = await inventoryList(actor, input.filters || {}, true);
  const selected = input.ids
    ? [...new Set(input.ids)].sort()
    : available.items.map((r) => r.id).sort();
  if (
    !selected.length ||
    selected.length > 5000 ||
    selected.some((id) => !available.items.some((r) => r.id === id))
  )
    throw new HttpError(
      400,
      "The selected SKU scope is invalid. Refresh the list.",
    );
  return {
    warehouse: input.warehouse,
    ids: selected,
    count: selected.length,
    hash: createHash("sha256")
      .update(JSON.stringify([input.warehouse, selected]))
      .digest("hex"),
  };
}
export async function saveStockPolicies(actor: Actor, input: unknown) {
  owner(actor);
  const v = stockSchema.parse(input);
  if ((v.mode === "CUSTOM") !== (v.threshold !== null))
    throw new HttpError(
      400,
      "Custom requires a threshold; other modes require no threshold.",
    );
  return command(actor, "stock-alert-batch", v.key, v, async (tx) => {
    const scope = await stockPreview(actor, v);
    if (scope.count !== v.expectedCount || scope.hash !== v.previewHash)
      throw new HttpError(
        409,
        "The matching scope changed. Preview the batch again.",
      );
    for (const variantId of scope.ids) {
      const old = await tx.stockAlertPolicy.findUnique({
        where: { variantId_warehouse: { variantId, warehouse: v.warehouse } },
      });
      const after = await tx.stockAlertPolicy.upsert({
        where: { variantId_warehouse: { variantId, warehouse: v.warehouse } },
        create: {
          variantId,
          warehouse: v.warehouse,
          mode: v.mode,
          threshold: v.threshold,
        },
        update: { mode: v.mode, threshold: v.threshold },
      });
      await audit(
        tx,
        actor,
        "STOCK_ALERT_POLICY",
        "sku",
        variantId,
        v.reason,
        old,
        after,
      );
    }
    return { count: scope.count };
  });
}
export async function stockPolicies(actor: Actor) {
  owner(actor);
  return database().stockAlertPolicy.findMany();
}
export async function productPolicies(actor: Actor) {
  owner(actor);
  return database()
    .product.findMany({
      select: { id: true, name: true, createdAt: true, status: true },
      orderBy: { createdAt: "desc" },
    })
    .then(async (products) => ({
      products,
      policies: await database().productCheckPolicy.findMany(),
    }));
}
export async function saveProductPolicies(actor: Actor, input: unknown) {
  owner(actor);
  const v = productSchema.parse(input);
  const ids = [...new Set(v.ids)];
  return command(actor, "product-check-batch", v.key, v, async (tx) => {
    if ((await tx.product.count({ where: { id: { in: ids } } })) !== ids.length)
      throw new HttpError(400, "A selected product no longer exists.");
    for (const productId of ids) {
      const before = await tx.productCheckPolicy.findUnique({
        where: { productId },
      });
      const after = await tx.productCheckPolicy.upsert({
        where: { productId },
        create: { productId, mode: v.mode },
        update: { mode: v.mode },
      });
      await audit(
        tx,
        actor,
        "PRODUCT_CHECK_POLICY",
        "product",
        productId,
        v.reason,
        before,
        after,
      );
    }
    return { count: ids.length };
  });
}
export { routing };
