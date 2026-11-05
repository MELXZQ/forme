import { z } from "zod";
const id = z.string().min(1).max(100);
export const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers and single hyphens.",
  );
const text = (max: number) => z.string().max(max);
const order = z.number().int().min(0).max(100000);
export const variantSchema = z
  .object({
    id: id.optional(),
    sku: z.string().trim().min(1).max(80),
    size: text(80).default(""),
    color: text(80).default(""),
    priceCents: z.number().int().min(1).max(100000000),
    compareAtPriceCents: z
      .number()
      .int()
      .min(1)
      .max(100000000)
      .nullable()
      .optional(),
    currency: z.literal("AUD").default("AUD"),
    stock: z.number().int().min(0).max(1000000),
    enabled: z.boolean().default(true),
    sortOrder: order.default(0),
  })
  .refine(
    (v) =>
      v.compareAtPriceCents == null || v.compareAtPriceCents > v.priceCents,
    {
      message: "Compare-at price must be higher than the selling price.",
      path: ["compareAtPriceCents"],
    },
  );
export const productSchema = z
  .object({
    slug: slugSchema,
    name: z.string().trim().min(1).max(180),
    summary: text(500).default(""),
    changeReason: z.string().trim().min(3).max(1000).optional(),
    description: text(20000).default(""),
    status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
    categoryId: id,
    isFeatured: z.boolean().default(false),
    featuredOrder: order.default(0),
    collectionIds: z.array(id).max(30).default([]),
    variants: z.array(variantSchema).min(1).max(100),
    images: z
      .array(
        z.object({
          mediaId: id,
          alt: text(500).optional(),
          variantId: id.nullable().optional(),
          sortOrder: order.default(0),
        }),
      )
      .max(20)
      .default([]),
  })
  .superRefine((p, ctx) => {
    if (new Set(p.variants.map((v) => v.sku)).size !== p.variants.length)
      ctx.addIssue({
        code: "custom",
        path: ["variants"],
        message: "SKU codes must be unique.",
      });
    const variantIds = p.variants.flatMap((v) => (v.id ? [v.id] : []));
    if (new Set(variantIds).size !== variantIds.length)
      ctx.addIssue({
        code: "custom",
        path: ["variants"],
        message: "Variant IDs must be unique.",
      });
    if (new Set(p.images.map((i) => i.mediaId)).size !== p.images.length)
      ctx.addIssue({
        code: "custom",
        path: ["images"],
        message: "Do not attach the same image twice.",
      });
    if (
      p.status === "PUBLISHED" &&
      (!p.variants.some((v) => v.enabled) ||
        !p.images.some(
          (image) =>
            !image.variantId ||
            p.variants.some((v) => v.id === image.variantId && v.enabled),
        ))
    )
      ctx.addIssue({
        code: "custom",
        path: ["status"],
        message:
          "Publishing requires an enabled SKU and an image visible to that SKU.",
      });
    for (const image of p.images)
      if (image.variantId && !variantIds.includes(image.variantId))
        ctx.addIssue({
          code: "custom",
          path: ["images"],
          message:
            "An image can only be linked to a saved SKU of this product.",
        });
  });
export const categorySchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  description: text(2000).default(""),
  sortOrder: order.default(0),
  active: z.boolean(),
});
export const collectionSchema = categorySchema.extend({
  mediaId: id.nullable().optional(),
  featured: z.boolean().default(true),
});
export const localHref = z
  .string()
  .max(500)
  .regex(/^\/(?!\/)[^\\\s]*$/, "Use a local URL beginning with a single /.");
export const cropSchema = z
  .string()
  .regex(
    /^(center|(?:100|\d{1,2})(?:\.\d+)?% (?:100|\d{1,2})(?:\.\d+)?%)$/,
    "Use center or two percentages, e.g. 50% 50%.",
  );
export const slideSchema = z.object({
  eyebrow: text(150).default(""),
  title: z.string().min(1).max(200),
  description: text(500).default(""),
  cta: z.string().min(1).max(100),
  href: localHref,
  desktopMediaId: id,
  mobileMediaId: id.nullable().optional(),
  position: cropSchema.default("50% 50%"),
  mobilePosition: cropSchema.default("50% 50%"),
  sortOrder: order.default(0),
  active: z.boolean(),
});
const coordinate = z.number().min(0).max(100);
export const markerSchema = z.object({
  categoryId: id,
  sortOrder: order,
  active: z.boolean(),
  desktopAnchorX: coordinate,
  desktopAnchorY: coordinate,
  desktopLabelX: coordinate,
  desktopLabelY: coordinate,
  mobileAnchorX: coordinate,
  mobileAnchorY: coordinate,
  mobileLabelX: coordinate,
  mobileLabelY: coordinate,
});
export const settingsSchema = z.object({
  desktopMediaId: id.nullable(),
  mobileMediaId: id.nullable(),
  desktopPosition: cropSchema,
  mobilePosition: cropSchema,
});
export type ProductInput = z.infer<typeof productSchema>;
export type VariantInput = z.infer<typeof variantSchema>;
