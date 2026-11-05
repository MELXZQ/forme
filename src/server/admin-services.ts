import "server-only";
import { audit, lock, type Actor } from "./operations/core";
import { database } from "./db";
import { HttpError } from "./errors";
import {
  productSchema,
  categorySchema,
  collectionSchema,
  slideSchema,
  settingsSchema,
  markerSchema,
} from "@/lib/validation";
export async function listAdminProducts(q = "", status = "") {
  const where = {
    ...(q
      ? { name: { contains: q.slice(0, 200), mode: "insensitive" as const } }
      : {}),
    ...(["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)
      ? { status: status as "DRAFT" | "PUBLISHED" | "ARCHIVED" }
      : {}),
  };
  return database().product.findMany({
    where,
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      updatedAt: true,
      category: { select: { name: true } },
      _count: { select: { variants: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
}
export async function adminProduct(id: string) {
  const p = await database().product.findUnique({
    where: { id },
    include: {
      variants: { orderBy: { sortOrder: "asc" } },
      images: { include: { media: true }, orderBy: { sortOrder: "asc" } },
      collections: true,
    },
  });
  if (!p) throw new HttpError(404, "Product not found.");
  return {
    ...p,
    images: p.images.map((i) => ({ ...i, alt: i.media.alt })),
    collectionIds: p.collections.map((c) => c.collectionId),
  };
}
export async function saveProduct(input: unknown, id?: string, actor?: Actor) {
  const parsed = productSchema.parse(input);
  const { variants, images, collectionIds, changeReason, ...fields } = parsed;
  return database().$transaction(async (tx) => {
    const current = id
      ? await tx.product.findUnique({
          where: { id },
          include: { variants: true },
        })
      : null;
    if (id && !current) throw new HttpError(404, "Product not found.");
    {
      for (const v of variants) {
        const old = current?.variants.find((p) => p.id === v.id);
        if ((v.id && old && v.stock !== old.stock) || (!v.id && v.stock !== 0))
          throw new HttpError(
            400,
            "Stock is managed through warehouse events, not the catalogue editor.",
          );
      }
      for (const variantId of (current?.variants.map((v) => v.id) ?? []).sort())
        await lock(tx, `inventory:${variantId}`);
    }
    if (
      variants.some(
        (v) => v.id && !current?.variants.some((old) => old.id === v.id),
      )
    )
      throw new HttpError(400, "A SKU belongs to a different product.");
    if (new Set(collectionIds).size !== collectionIds.length)
      throw new HttpError(400, "Duplicate collection.");
    if (!(await tx.category.findUnique({ where: { id: fields.categoryId } })))
      throw new HttpError(400, "Choose an existing category.");
    if (
      (await tx.collection.count({ where: { id: { in: collectionIds } } })) !==
      collectionIds.length
    )
      throw new HttpError(400, "A collection no longer exists.");
    if (
      (await tx.media.count({
        where: { id: { in: images.map((i) => i.mediaId) } },
      })) !== images.length
    )
      throw new HttpError(400, "An image no longer exists.");
    const publishedAt =
      fields.status === "PUBLISHED"
        ? current?.publishedAt || new Date()
        : current?.publishedAt || null;
    const product = id
      ? await tx.product.update({
          where: { id },
          data: { ...fields, publishedAt },
        })
      : await tx.product.create({ data: { ...fields, publishedAt } });
    await tx.productImage.deleteMany({ where: { productId: product.id } });
    // Disable removed SKUs instead of deleting stable IDs used by a saved demo bag.
    await tx.productVariant.updateMany({
      where: {
        productId: product.id,
        id: { notIn: variants.flatMap((v) => (v.id ? [v.id] : [])) },
      },
      data: { enabled: false },
    });
    for (const v of variants) {
      const { id: variantId, stock: originalLegacyStock, ...data } = v;
      void originalLegacyStock;
      if (variantId)
        await tx.productVariant.update({ where: { id: variantId }, data });
      else
        await tx.productVariant.create({
          data: { ...data, productId: product.id },
        });
    }
    await tx.productCollection.deleteMany({ where: { productId: product.id } });
    if (collectionIds.length)
      await tx.productCollection.createMany({
        data: collectionIds.map((collectionId) => ({
          productId: product.id,
          collectionId,
        })),
      });
    for (const image of images)
      if (image.alt !== undefined)
        await tx.media.update({
          where: { id: image.mediaId },
          data: { alt: image.alt },
        });
    if (images.length)
      await tx.productImage.createMany({
        data: images.map((i) => ({
          mediaId: i.mediaId,
          variantId: i.variantId,
          sortOrder: i.sortOrder,
          productId: product.id,
        })),
      });
    if (actor)
      await audit(
        tx,
        actor,
        current ? "PRODUCT_UPDATED" : "PRODUCT_CREATED",
        "product",
        product.id,
        changeReason || "Catalogue update",
        current
          ? {
              name: current.name,
              status: current.status,
              categoryId: current.categoryId,
              variants: current.variants.map((v) => ({
                id: v.id,
                sku: v.sku,
                priceCents: v.priceCents,
                compareAtPriceCents: v.compareAtPriceCents,
                enabled: v.enabled,
              })),
            }
          : undefined,
        {
          name: product.name,
          status: product.status,
          categoryId: product.categoryId,
          variants: variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            priceCents: v.priceCents,
            compareAtPriceCents: v.compareAtPriceCents,
            enabled: v.enabled,
          })),
        },
      );
    return { id: product.id, slug: product.slug };
  });
}
export async function saveTaxonomy(
  kind: "categories" | "collections",
  input: unknown,
  id?: string,
) {
  if (kind === "categories") {
    const data = categorySchema.parse(input);
    return id
      ? database().category.update({ where: { id }, data })
      : database().category.create({ data });
  }
  const data = collectionSchema.parse(input);
  return id
    ? database().collection.update({ where: { id }, data })
    : database().collection.create({ data });
}
export async function listAdminTaxonomies(kind: "categories" | "collections") {
  const db = database();
  return kind === "categories"
    ? db.category.findMany({ orderBy: { sortOrder: "asc" } })
    : db.collection.findMany({ orderBy: { sortOrder: "asc" } });
}
export async function getAdminHome() {
  const db = database();
  const [settings, slides, markers] = await Promise.all([
    db.homeSettings.findUnique({ where: { id: "home" } }),
    db.heroSlide.findMany({ orderBy: { sortOrder: "asc" } }),
    db.modelMarker.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return { settings, slides, markers };
}
export async function saveHome(input: unknown) {
  if (
    !input ||
    typeof input !== "object" ||
    !("kind" in input) ||
    !("data" in input)
  )
    throw new HttpError(400, "Invalid home content.");
  const id =
    "id" in input && typeof input.id === "string" ? input.id : undefined;
  if (input.kind === "settings") {
    const data = settingsSchema.parse(input.data);
    return database().homeSettings.upsert({
      where: { id: "home" },
      create: { id: "home", ...data },
      update: data,
    });
  }
  if (input.kind === "slide") {
    const data = slideSchema.parse(input.data);
    return id
      ? database().heroSlide.update({ where: { id }, data })
      : database().heroSlide.create({ data });
  }
  if (input.kind === "marker") {
    const data = markerSchema.parse(input.data);
    return id
      ? database().modelMarker.update({ where: { id }, data })
      : database().modelMarker.create({ data });
  }
  throw new HttpError(400, "Unknown home content type.");
}
