import { z } from "zod";
import { key, reason, quantity, ident } from "../operations/validation";
export const timezone = z.enum(["Australia/Melbourne", "Asia/Shanghai"]);
export const category = z.enum([
  "INVENTORY",
  "PRODUCT",
  "LOGISTICS",
  "SYSTEM",
  "PROCUREMENT",
  "FINANCE",
]);
export const audience = z
  .object({
    assigneeId: ident,
    recipientIds: z.array(ident).min(1).max(100),
    confirmerIds: z.array(ident).min(1).max(100),
  })
  .strict();
export const routing = z
  .object({
    INVENTORY: audience.optional(),
    PRODUCT: audience.optional(),
    LOGISTICS: audience.optional(),
    SYSTEM: audience.optional(),
    PROCUREMENT: audience.optional(),
    FINANCE: audience.optional(),
  })
  .strict();
export const rulesSchema = z
  .object({
    key,
    reason,
    beijingThreshold: quantity.nullable(),
    melbourneThreshold: quantity.nullable(),
    productEnabled: z.boolean(),
    productNewDefault: z.boolean(),
    productScope: z.enum(["FUTURE", "EXISTING"]),
    overdueGraceDays: quantity.max(90),
    autoPinOutOfStock: z.boolean(),
    routing,
  })
  .strict();
export const actionSchema = z
  .object({
    key,
    reason,
    version: z.number().int().positive(),
    action: z.enum([
      "read",
      "ack",
      "progress",
      "resolve",
      "dismiss",
      "note",
      "assign",
      "pin",
      "unpin",
      "reassign",
    ]),
    assigneeId: ident.optional(),
    confirmerIds: z.array(ident).min(1).max(100).optional(),
  })
  .strict();
export const stockSchema = z
  .object({
    key,
    reason,
    warehouse: z.enum(["BEIJING", "MELBOURNE"]),
    mode: z.enum(["INHERIT", "CUSTOM", "OFF"]),
    threshold: quantity.nullable(),
    ids: z.array(ident).max(5000).optional(),
    filters: z.record(z.string(), z.string()).optional(),
    expectedCount: z.number().int().min(1).max(5000),
    previewHash: z.string().length(64),
  })
  .strict();
export const productSchema = z
  .object({
    key,
    reason,
    mode: z.enum(["INHERIT", "ON", "OFF"]),
    ids: z.array(ident).min(1).max(5000),
  })
  .strict();
