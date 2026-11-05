import { z } from "zod";
export const warehouseSchema = z.enum(["BEIJING", "MELBOURNE"]);
export const quantity = z.number().int().min(0).max(1_000_000);
export const positive = quantity.min(1);
export const reason = z.string().trim().min(3).max(1000);
export const ident = z.string().min(1).max(120);
export const key = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/);
export const stockAction = z.object({
  key,
  variantId: ident,
  warehouse: warehouseSchema,
  kind: z.enum(["INITIAL", "PURCHASE", "LEGACY", "DAMAGE", "RESTORE", "LOSS"]),
  quantity: positive,
  unavailableQuantity: quantity.default(0),
  reason,
});
export const adjustmentSchema = z.object({
  key,
  variantId: ident,
  warehouse: warehouseSchema,
  countedOnHand: quantity,
  reason,
});
const date = z.string().datetime({ offset: true }).nullable().optional();
export const transferSchema = z
  .object({
    key,
    lines: z
      .array(z.object({ variantId: ident, planned: positive }))
      .min(1)
      .max(100),
    carrier: z.string().max(120).default(""),
    trackingNumber: z.string().max(200).default(""),
    etaStart: date,
    etaEnd: date,
    notes: z.string().max(2000).default(""),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.lines.map((l) => l.variantId)).size !== v.lines.length)
      c.addIssue({
        code: "custom",
        message: "Duplicate SKU.",
        path: ["lines"],
      });
    if (v.etaStart && v.etaEnd && v.etaStart > v.etaEnd)
      c.addIssue({
        code: "custom",
        message: "ETA end must not precede start.",
        path: ["etaEnd"],
      });
  });
export const receiptSchema = z
  .object({
    key,
    reason,
    notes: z.string().max(2000).default(""),
    attachmentMediaIds: z.array(ident).max(5).default([]),
    lines: z
      .array(
        z.object({
          lineId: ident,
          sellable: quantity,
          unavailable: quantity,
          lost: quantity,
        }),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.lines.map((l) => l.lineId)).size !== v.lines.length)
      c.addIssue({
        code: "custom",
        message: "Duplicate transfer line.",
        path: ["lines"],
      });
    if (!v.lines.some((l) => l.sellable + l.unavailable + l.lost > 0))
      c.addIssue({
        code: "custom",
        message: "Enter an actual receipt or confirmed loss.",
        path: ["lines"],
      });
  });
export const checkoutSchema = z
  .object({
    key,
    items: z
      .array(z.object({ variantId: ident, quantity: positive.max(99) }))
      .min(1)
      .max(30),
    email: z.email().max(254),
    recipientName: z.string().trim().min(2).max(150),
    addressLine1: z.string().trim().min(3).max(200),
    addressLine2: z.string().max(200).default(""),
    city: z.string().trim().min(2).max(100),
    state: z.enum(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"]),
    postcode: z.string().regex(/^\d{4}$/),
    country: z.literal("AU").default("AU"),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.items.map((i) => i.variantId)).size !== v.items.length)
      c.addIssue({
        code: "custom",
        message: "Combine duplicate SKU lines.",
        path: ["items"],
      });
  });
export const commerceSchema = z.object({
  key,
  shippingCents: z.number().int().min(0).max(100000).nullable(),
  reservationMinutes: z.number().int().min(1).max(1440),
  reason,
});
