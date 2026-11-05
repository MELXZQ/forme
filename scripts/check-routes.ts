import assert from "node:assert/strict";
import { guides, services } from "../src/data/services";
import type {
  ProductPage,
  Category,
  Collection,
  Slide,
  ModelScene,
} from "../src/lib/types";
async function main() {
  const base = process.env.BASE_URL || "http://127.0.0.1:3000";
  async function read<T>(path: string) {
    const r = await fetch(`${base}/api/catalog/${path}`);
    assert.equal(r.status, 200, path);
    return (await r.json()).data as T;
  }
  const [page, categories, collections, home] = await Promise.all([
    read<ProductPage>("products?pageSize=48"),
    read<Category[]>("categories"),
    read<Collection[]>("collections"),
    read<{ slides: Slide[]; modelScene: ModelScene }>("home"),
  ]);
  const routes = [
    "/",
    "/shop",
    "/shop?sort=newest",
    "/shop?sale=true",
    "/shop?q=chain",
    "/shop?q=missing-piece",
    ...page.items.map((p) => `/products/${p.slug}`),
    ...categories.map((c) => `/shop?category=${c.slug}`),
    ...collections.map((c) => `/shop?collection=${c.slug}`),
    ...[...guides, ...services].map((i) => `/info/${i.slug}`),
    "/admin/login",
  ];
  for (const path of routes) {
    const r = await fetch(base + path);
    assert.equal(r.status, 200, path);
    assert.ok((await r.text()).includes("<main"), path);
  }
  const assets = new Set([
    ...page.items.flatMap((p) => p.images.map((i) => i.src)),
    ...collections.map((c) => c.image),
    ...home.slides.flatMap((s) => [s.image, s.mobileImage]),
    home.modelScene.desktop.image,
    home.modelScene.mobile.image,
    "/images/fallback.svg",
    "/icon.svg",
  ]);
  for (const asset of assets)
    assert.equal((await fetch(base + asset)).status, 200, asset);
  assert.equal(
    (await fetch(base + "/api/catalog/products/does-not-exist")).status,
    404,
  );
  assert.equal((await fetch(base + "/info/does-not-exist")).status, 404);
  console.log(
    `PASS: ${routes.length} storefront/admin-login URLs, ${assets.size} assets and hidden/missing API responses.`,
  );
}
main().catch(() => {
  console.error(
    "Route verification failed. Check the running site and database.",
  );
  process.exitCode = 1;
});
