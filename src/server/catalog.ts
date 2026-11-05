import "server-only";
import { publicAvailability } from "./operations/availability";
import {
  aggregateAvailability,
  type PublicAvailability,
} from "@/lib/availability";
import { database } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import type {
  Product,
  ShopQuery,
  ProductPage,
  Category,
  Collection,
  ModelScene,
  Slide,
} from "@/lib/types";
export const publicProductWhere: Prisma.ProductWhereInput = {
  status: "PUBLISHED",
  category: { active: true },
  variants: { some: { enabled: true } },
};
const include = {
  category: true,
  variants: {
    where: { enabled: true },
    orderBy: [
      { priceCents: "asc" as const },
      { sortOrder: "asc" as const },
      { id: "asc" as const },
    ],
  },
  images: {
    include: { media: true },
    orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }],
  },
  collections: {
    where: { collection: { active: true } },
    include: { collection: true },
  },
};
type RecordProduct = Prisma.ProductGetPayload<{ include: typeof include }>;
export function mediaUrl(media: { id: string }) {
  return `/media/${media.id}`;
}
function serialize(
  p: RecordProduct,
  availability: Map<string, PublicAvailability>,
): Product {
  const first = p.variants[0];
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    summary: p.summary,
    description: p.description,
    category: p.category.slug,
    priceCents: first.priceCents,
    compareAtPriceCents: first.compareAtPriceCents,
    currency: "AUD",
    images: p.images
      .filter(
        (i) => !i.variantId || p.variants.some((v) => v.id === i.variantId),
      )
      .map((i) => ({
        src: mediaUrl(i.media),
        alt: i.media.alt,
        variantId: i.variantId,
      })),
    isNew: p.isFeatured,
    isOnSale: p.variants.some(
      (v) =>
        v.compareAtPriceCents !== null && v.compareAtPriceCents > v.priceCents,
    ),
    fromPrice: new Set(p.variants.map((v) => v.priceCents)).size > 1,
    collectionIds: p.collections.map((c) => c.collection.slug),
    releasedAt: p.publishedAt!.toISOString(),
    availability: aggregateAvailability(
      p.variants.map((v) => availability.get(v.id)!.status),
    ),
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      size: v.size,
      color: v.color,
      priceCents: v.priceCents,
      compareAtPriceCents: v.compareAtPriceCents,
      currency: "AUD",
      stock: availability.get(v.id)!.stock,
      availability: availability.get(v.id)!,
    })),
  };
}
async function serializeMany(rows: RecordProduct[]) {
  const availability = await publicAvailability(
    rows.flatMap((p) => p.variants.map((v) => v.id)),
  );
  return rows.map((p) => serialize(p, availability));
}
export async function getProducts(query: ShopQuery = {}): Promise<Product[]> {
  const q = query.q?.trim().slice(0, 200);
  const where: Prisma.ProductWhereInput = {
    ...publicProductWhere,
    ...(query.category
      ? { category: { active: true, slug: query.category } }
      : {}),
    ...(query.collection
      ? {
          collections: {
            some: { collection: { slug: query.collection, active: true } },
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { category: { slug: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  let result = await serializeMany(
    await database().product.findMany({
      where,
      include,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    }),
  );
  if (query.sale === "true") result = result.filter((p) => p.isOnSale);
  if (query.sort === "newest")
    result.sort(
      (a, b) =>
        b.releasedAt.localeCompare(a.releasedAt) || a.id.localeCompare(b.id),
    );
  if (query.sort === "price-asc")
    result.sort(
      (a, b) => a.priceCents - b.priceCents || a.id.localeCompare(b.id),
    );
  if (query.sort === "price-desc")
    result.sort(
      (a, b) => b.priceCents - a.priceCents || a.id.localeCompare(b.id),
    );
  return result;
}
export async function listProducts(
  query: ShopQuery = {},
): Promise<ProductPage> {
  const pageSize = Math.max(
    1,
    Math.min(48, Number.parseInt(query.pageSize || "12", 10) || 12),
  );
  const all = await getProducts(query);
  const pageCount = Math.max(1, Math.ceil(all.length / pageSize));
  const page = Math.min(
    pageCount,
    Math.max(1, Number.parseInt(query.page || "1", 10) || 1),
  );
  return {
    items: all.slice((page - 1) * pageSize, page * pageSize),
    total: all.length,
    page,
    pageSize,
    pageCount,
  };
}
export async function getProduct(slug: string) {
  const p = await database().product.findFirst({
    where: { ...publicProductWhere, slug },
    include,
  });
  return p ? (await serializeMany([p]))[0] : undefined;
}
export async function getNewArrivals() {
  return serializeMany(
    await database().product.findMany({
      where: { ...publicProductWhere, isFeatured: true },
      include,
      orderBy: [{ featuredOrder: "asc" }, { id: "asc" }],
      take: 8,
    }),
  );
}
export async function getDeals() {
  return (await getProducts({ sale: "true" })).slice(0, 8);
}
export async function getCategories(): Promise<Category[]> {
  return (
    await database().category.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    })
  ).map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    short: c.name,
    description: c.description,
    sortOrder: c.sortOrder,
  }));
}
export async function getCollections(homeOnly = false): Promise<Collection[]> {
  return (
    await database().collection.findMany({
      where: { active: true, ...(homeOnly ? { featured: true } : {}) },
      include: { media: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    })
  ).map((c, i) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    image: c.media ? mediaUrl(c.media) : "/images/fallback.svg",
    alt: c.media?.alt || c.name,
    eyebrow: `COLLECTION ${String(i + 1).padStart(2, "0")}`,
  }));
}
export async function getHome() {
  const db = database();
  const [rows, settings, markers] = await Promise.all([
    db.heroSlide.findMany({
      where: { active: true },
      include: { desktopMedia: true, mobileMedia: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    db.homeSettings.findUnique({
      where: { id: "home" },
      include: { desktopMedia: true, mobileMedia: true },
    }),
    db.modelMarker.findMany({
      where: { active: true, category: { active: true } },
      include: { category: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
  ]);
  const slides: Slide[] = rows.map((s) => ({
    id: s.id,
    eyebrow: s.eyebrow,
    title: s.title,
    description: s.description,
    cta: s.cta,
    href: s.href,
    image: mediaUrl(s.desktopMedia),
    mobileImage: mediaUrl(s.mobileMedia || s.desktopMedia),
    position: s.position,
    mobilePosition: s.mobilePosition,
    alt: s.desktopMedia.alt,
  }));
  const modelScene: ModelScene = {
    desktop: {
      image: settings?.desktopMedia
        ? mediaUrl(settings.desktopMedia)
        : "/images/fallback.svg",
      alt: settings?.desktopMedia?.alt || "Model image unavailable",
      objectPosition: settings?.desktopPosition || "50% 50%",
    },
    mobile: {
      image: settings?.mobileMedia
        ? mediaUrl(settings.mobileMedia)
        : "/images/fallback.svg",
      alt: settings?.mobileMedia?.alt || "Model image unavailable",
      objectPosition: settings?.mobilePosition || "50% 50%",
    },
    markers: markers.map((m, i) => ({
      id: m.category.slug,
      name: m.category.name,
      order: i,
      desktop: {
        anchor: [m.desktopAnchorX, m.desktopAnchorY],
        label: [m.desktopLabelX, m.desktopLabelY],
      },
      mobile: {
        anchor: [m.mobileAnchorX, m.mobileAnchorY],
        label: [m.mobileLabelX, m.mobileLabelY],
      },
    })),
  };
  return { slides, modelScene };
}
export async function getBagItems(ids: string[]) {
  const products = await serializeMany(
    await database().product.findMany({
      where: {
        ...publicProductWhere,
        OR: [
          { id: { in: ids } },
          { variants: { some: { id: { in: ids }, enabled: true } } },
        ],
      },
      include,
    }),
  );
  return ids.flatMap((id) => {
    const p = products.find(
      (p) => p.id === id || p.variants.some((v) => v.id === id),
    );
    if (!p) return [];
    const v = p.variants.find((v) => v.id === id) || p.variants[0];
    return [
      {
        id,
        productId: p.id,
        name: p.name,
        slug: p.slug,
        image: p.images.find((i) => i.variantId === v.id) ||
          p.images[0] || { src: "/images/fallback.svg", alt: p.name },
        variantId: v.id,
        option: [v.size, v.color].filter(Boolean).join(" / ") || "Default",
        priceCents: v.priceCents,
        stock: v.stock,
      },
    ];
  });
}
