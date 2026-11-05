import "server-only";
import { z } from "zod";
import { database } from "../db";
import { command, audit, owner, type Actor } from "./core";
import { commerceSchema, key, ident, reason, quantity } from "./validation";
export async function commerceSettings() {
  return (
    (await database().commerceSettings.findUnique({
      where: { id: "commerce" },
    })) ?? { shippingCents: null, reservationMinutes: 30 }
  );
}
export async function saveCommerceSettings(actor: Actor, input: unknown) {
  owner(actor);
  const v = commerceSchema.parse(input);
  return command(actor, "commerce-settings", v.key, v, async (tx) => {
    const before = await tx.commerceSettings.findUnique({
      where: { id: "commerce" },
    });
    const after = await tx.commerceSettings.upsert({
      where: { id: "commerce" },
      create: {
        id: "commerce",
        shippingCents: v.shippingCents,
        reservationMinutes: v.reservationMinutes,
      },
      update: {
        shippingCents: v.shippingCents,
        reservationMinutes: v.reservationMinutes,
      },
    });
    await audit(
      tx,
      actor,
      "COMMERCE_SETTINGS",
      "settings",
      "commerce",
      v.reason,
      before,
      after,
    );
    return { id: "commerce" };
  });
}
const policySchema = z.object({
  key,
  variantId: ident,
  lowStockThreshold: quantity.optional(),
  showRestocking: z.boolean(),
  reason,
});
export async function saveSkuPolicy(actor: Actor, input: unknown) {
  owner(actor);
  const v = policySchema.parse(input);
  return command(actor, "sku-policy", v.key, v, async (tx) => {
    const before = await tx.skuPolicy.findUnique({
      where: { variantId: v.variantId },
    });
    const after = await tx.skuPolicy.upsert({
      where: { variantId: v.variantId },
      create: {
        variantId: v.variantId,
        lowStockThreshold: v.lowStockThreshold,
        showRestocking: v.showRestocking,
      },
      update: {
        lowStockThreshold: v.lowStockThreshold,
        showRestocking: v.showRestocking,
      },
    });
    if (v.lowStockThreshold !== undefined)
      await tx.stockAlertPolicy.upsert({
        where: {
          variantId_warehouse: {
            variantId: v.variantId,
            warehouse: "MELBOURNE",
          },
        },
        create: {
          variantId: v.variantId,
          warehouse: "MELBOURNE",
          mode: "CUSTOM",
          threshold: v.lowStockThreshold,
        },
        update: { mode: "CUSTOM", threshold: v.lowStockThreshold },
      });
    await audit(
      tx,
      actor,
      "SKU_POLICY",
      "sku",
      v.variantId,
      v.reason,
      before,
      after,
    );
    return { variantId: v.variantId };
  });
}
