import { database } from "../src/server/db";
import { products } from "../src/data/products";
import { categories } from "../src/data/categories";
import { collections } from "../src/data/collections";
import { slides } from "../src/data/slides";
import { modelScene } from "../src/data/model";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
const db = database();
async function seed() {
 for(const [id,name] of Object.entries({'purchase':'采购','domestic-freight':'国内运费','international-freight':'国际运输','au-delivery':'澳洲配送','packaging':'包装','software':'软件订阅','domain':'域名','marketing':'营销','other':'其他'})) await db.expenseCategory.upsert({where:{id},create:{id,name},update:{}});
  await db.notificationRuleSettings.upsert({
    where: { id: "notifications" },
    create: { id: "notifications" },
    update: {},
  });
  await db.notificationJob.upsert({
    where: { id: "notifications" },
    create: { id: "notifications" },
    update: {},
  });
  const media = new Map<string, string>();
  const paths = new Map<string, string>();
  for (const p of products)
    for (const image of p.images) paths.set(image.src, image.alt);
  for (const c of collections) paths.set(c.image, c.alt);
  for (const s of slides) {
    paths.set(s.image, s.alt);
    paths.set(s.mobileImage, s.alt);
  }
  paths.set(modelScene.desktop.image, modelScene.desktop.alt);
  paths.set(modelScene.mobile.image, modelScene.mobile.alt);
  for (const [src, alt] of paths) {
    const key = src.replace(/^\/images\//, "");
    const id = `seed-${key.replace(/[^a-z0-9]/gi, "-")}`;
    const bytes = await readFile(`public/images/${key}`);
    const meta = await sharp(bytes).metadata();
    const record = await db.media.upsert({
      where: { id },
      update: {},
      create: {
        id,
        storageKey: key,
        source: "seed",
        mimeType: "image/svg+xml",
        sizeBytes: bytes.length,
        width: meta.width || 500,
        height: meta.height || 500,
        alt,
      },
    });
    media.set(src, record.id);
  }
  for (const [i, c] of categories.entries())
    await db.category.upsert({
      where: { id: c.id },
      update: {},
      create: { id: c.id, slug: c.id, name: c.short, sortOrder: i },
    });
  for (const [i, c] of collections.entries())
    await db.collection.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        slug: c.id,
        name: c.name,
        description: c.description,
        mediaId: media.get(c.image),
        sortOrder: i,
      },
    });
  for (const [i, p] of products.entries()) {
    const category = await db.category.findUniqueOrThrow({
      where: { id: p.category },
    });
    const actualCollections = await db.collection.findMany({
      where: { id: { in: p.collectionIds } },
      select: { id: true },
    });
    await db.product.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        slug: p.slug,
        name: p.name,
        summary: p.description,
        description: p.description,
        categoryId: category.id,
        status: "PUBLISHED",
        isFeatured: p.isNew,
        featuredOrder: i,
        publishedAt: new Date(p.releasedAt),
        variants: {
          create: {
            id: `sku-${p.id}`,
            sku: `FORME-${p.slug.toUpperCase()}`,
            priceCents: Math.round(p.price * 100),
            compareAtPriceCents: p.compareAtPrice
              ? Math.round(p.compareAtPrice * 100)
              : null,
            stock: 10,
            enabled: true,
          },
        },
        images: {
          create: p.images.map((image, sortOrder) => ({
            mediaId: media.get(image.src)!,
            sortOrder,
          })),
        },
        collections: {
          create: actualCollections.map((c) => ({ collectionId: c.id })),
        },
      },
    });
    const oldSku = await db.productVariant.findUnique({
      where: { id: `sku-${p.id}` },
    });
    if (oldSku && oldSku.stock > 0)
      await db.legacyStock.upsert({
        where: { variantId: oldSku.id },
        update: {},
        create: {
          variantId: oldSku.id,
          originalQty: oldSku.stock,
          remainingQty: oldSku.stock,
        },
      });
  }
  for (const [i, s] of slides.entries())
    await db.heroSlide.upsert({
      where: { id: s.id },
      update: {},
      create: {
        id: s.id,
        eyebrow: s.eyebrow,
        title: s.title,
        description: s.description,
        cta: s.cta,
        href: s.href,
        desktopMediaId: media.get(s.image)!,
        mobileMediaId: media.get(s.mobileImage),
        position: s.position,
        mobilePosition: s.mobilePosition,
        sortOrder: i,
      },
    });
  await db.homeSettings.upsert({
    where: { id: "home" },
    update: {},
    create: {
      id: "home",
      desktopMediaId: media.get(modelScene.desktop.image),
      mobileMediaId: media.get(modelScene.mobile.image),
    },
  });
  for (const m of modelScene.markers) {
    const category = await db.category.findUniqueOrThrow({
      where: { id: m.id },
    });
    await db.modelMarker.upsert({
      where: { id: `marker-${m.id}` },
      update: {},
      create: {
        id: `marker-${m.id}`,
        categoryId: category.id,
        sortOrder: m.order,
        desktopAnchorX: m.desktop.anchor[0],
        desktopAnchorY: m.desktop.anchor[1],
        desktopLabelX: m.desktop.label[0],
        desktopLabelY: m.desktop.label[1],
        mobileAnchorX: m.mobile.anchor[0],
        mobileAnchorY: m.mobile.anchor[1],
        mobileLabelX: m.mobile.label[0],
        mobileLabelY: m.mobile.label[1],
      },
    });
  }
  console.log(
    "Seed complete. Existing records and administrator edits were preserved. No admin password was created.",
  );
}
seed()
  .catch(() => {
    console.error("Seed failed. Check the database and migrations.");
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
