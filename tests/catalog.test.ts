import test from "node:test";
import assert from "node:assert/strict";
import {
  productSchema,
  variantSchema,
  slideSchema,
  markerSchema,
} from "../src/lib/validation";
import { money, discount } from "../src/lib/format";
import { processImage } from "../src/server/storage";
import sharp from "sharp";
const validVariant = {
  sku: "QA-ONE",
  priceCents: 8900,
  compareAtPriceCents: 9900,
  stock: 2,
  currency: "AUD",
  enabled: true,
  sortOrder: 0,
  size: "M",
  color: "",
};
test("AUD prices use integer minor units and accurate formatting", () => {
  assert.equal(money(8950), "$89.50");
  assert.equal(money(8900), "$89");
  assert.equal(discount({ priceCents: 5900, compareAtPriceCents: 7900 }), 25);
  for (const changes of [
    { priceCents: -1 },
    { priceCents: 10.5 },
    { stock: -1 },
    { stock: 1.2 },
    { compareAtPriceCents: 8900 },
    { currency: "USD" },
  ])
    assert.equal(
      variantSchema.safeParse({ ...validVariant, ...changes }).success,
      false,
    );
  assert.equal(variantSchema.safeParse(validVariant).success, true);
});
test("publication requires enabled SKUs and images; duplicate SKUs are rejected", () => {
  const draft = {
    slug: "qa-ring",
    name: "QA ring",
    status: "DRAFT",
    categoryId: "rings",
    variants: [validVariant],
    images: [],
  };
  assert.equal(productSchema.safeParse(draft).success, true);
  assert.equal(
    productSchema.safeParse({ ...draft, status: "PUBLISHED" }).success,
    false,
  );
  assert.equal(
    productSchema.safeParse({
      ...draft,
      variants: [validVariant, validVariant],
    }).success,
    false,
  );
  assert.equal(
    productSchema.safeParse({ ...draft, slug: "../escape" }).success,
    false,
  );
  assert.equal(
    productSchema.safeParse({
      ...draft,
      status: "PUBLISHED",
      images: [{ mediaId: "test-media" }],
    }).success,
    true,
  );
  assert.equal(
    productSchema.safeParse({
      ...draft,
      status: "PUBLISHED",
      variants: [
        { ...validVariant, id: "active-sku" },
        { ...validVariant, id: "disabled-sku", sku: "QA-TWO", enabled: false },
      ],
      images: [{ mediaId: "test-media", variantId: "disabled-sku" }],
    }).success,
    false,
  );
});
test("homepage links and positions are bounded and cannot inject arbitrary URLs", () => {
  const slide = {
    title: "New edit",
    cta: "Shop",
    href: "/shop?category=rings",
    desktopMediaId: "media",
    active: true,
  };
  assert.equal(slideSchema.safeParse(slide).success, true);
  for (const href of ["javascript:alert(1)", "//example.com", "/\\example.com"])
    assert.equal(slideSchema.safeParse({ ...slide, href }).success, false);
  assert.equal(
    markerSchema.safeParse({
      categoryId: "rings",
      sortOrder: 0,
      active: true,
      desktopAnchorX: 101,
      desktopAnchorY: 50,
      desktopLabelX: 0,
      desktopLabelY: 50,
      mobileAnchorX: 50,
      mobileAnchorY: 50,
      mobileLabelX: 0,
      mobileLabelY: 50,
    }).success,
    false,
  );
});
test("actual image bytes are decoded and re-encoded; SVG and MIME spoofing are rejected", async () => {
  const bytes = await sharp({
    create: { width: 20, height: 16, channels: 3, background: "#cd8965" },
  })
    .png()
    .toBuffer();
  const result = await processImage(
    new File([new Uint8Array(bytes)], "photo.png", { type: "image/png" }),
  );
  assert.equal(result.mimeType, "image/webp");
  assert.equal(result.width, 20);
  assert.equal((await sharp(result.bytes).metadata()).format, "webp");
  await assert.rejects(() =>
    processImage(
      new File([new Uint8Array(bytes)], "fake.jpg", { type: "image/jpeg" }),
    ),
  );
  await assert.rejects(() =>
    processImage(
      new File(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>',
        ],
        "image.svg",
        { type: "image/svg+xml" },
      ),
    ),
  );
  await assert.rejects(() =>
    processImage(
      new File(["not an image"], "image.png", { type: "image/png" }),
    ),
  );
});
