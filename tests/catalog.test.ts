import test from "node:test";
import assert from "node:assert/strict";
import {
  getProducts,
  getNewArrivals,
  getDeals,
  getProduct,
  discount,
} from "../src/lib/catalog";
import { modelScene } from "../src/data/model";
import { getCategories, getCollections } from "../src/lib/catalog";
import { access } from "node:fs/promises";
import path from "node:path";

test("catalogue uses unique stable IDs, valid categories and real local assets", async () => {
  const all = getProducts();
  assert.equal(new Set(all.map((p) => p.id)).size, all.length);
  assert.equal(new Set(all.map((p) => p.slug)).size, all.length);
  for (const p of all) {
    assert.ok(getCategories().some((c) => c.id === p.category));
    assert.ok(
      p.collectionIds.every((id) => getCollections().some((c) => c.id === id)),
    );
    assert.equal(p.currency, "AUD");
    assert.equal(p.isOnSale, !!p.compareAtPrice && p.compareAtPrice > p.price);
    assert.equal(getProduct(p.slug)?.id, p.id);
    for (const image of p.images)
      await access(path.join(process.cwd(), "public", image.src));
  }
});
test("homepage provides eight actual new arrivals and eight genuine deals", () => {
  assert.equal(getNewArrivals().length, 8);
  assert.ok(getNewArrivals().every((p) => p.isNew));
  assert.equal(getDeals().length, 8);
  assert.ok(getDeals().every((p) => p.isOnSale && p.compareAtPrice! > p.price));
  assert.equal(discount({ price: 59, compareAtPrice: 79 }), 25);
  assert.equal(discount({ price: 89 }), 0);
  assert.equal(discount({ price: 90, compareAtPrice: 80 }), 0);
});
test("filters intersect and sorting is deterministic", () => {
  const results = getProducts({
    category: "rings",
    sale: "true",
    collection: "quiet-form",
    sort: "price-asc",
  });
  assert.deepEqual(
    results.map((p) => p.slug),
    ["double-band", "ridge-ring"],
  );
  assert.equal(getProducts({ q: "  CHAIN  " }).length, 3);
  assert.equal(getProducts({ q: "not-a-product" }).length, 0);
  assert.equal(getProducts({ category: "missing" }).length, 0);
  assert.equal(getProducts({ sort: "newest" })[0].slug, "arc-signet");
  const sorted = getProducts({ sort: "price-desc" });
  assert.ok(sorted.every((p, i) => i === 0 || sorted[i - 1].price >= p.price));
});
test("every model marker has independently configured mobile and desktop targets", async () => {
  assert.equal(modelScene.markers.length, 5);
  for (const marker of modelScene.markers) {
    assert.ok(getCategories().some((c) => c.id === marker.id));
    for (const placement of [marker.desktop, marker.mobile])
      for (const v of [...placement.anchor, ...placement.label])
        assert.ok(v >= 0 && v <= 100);
  }
  for (const scene of [modelScene.desktop, modelScene.mobile])
    await access(path.join(process.cwd(), "public", scene.image));
});
