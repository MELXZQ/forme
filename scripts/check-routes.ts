import assert from "node:assert/strict";
import { getProducts, getCategories, getCollections } from "../src/lib/catalog";
import { guides, services } from "../src/data/services";
import { slides } from "../src/data/slides";
import { modelScene } from "../src/data/model";
async function main() {
  const base = process.env.BASE_URL || "http://127.0.0.1:3000";
  const routes = [
    "/",
    "/shop",
    "/shop?sort=newest",
    "/shop?sale=true",
    "/shop?q=chain",
    "/shop?q=missing-piece",
    ...getProducts().map((p) => `/products/${p.slug}`),
    ...getCategories().map((c) => `/shop?category=${c.id}`),
    ...getCollections().map((c) => `/shop?collection=${c.id}`),
    ...[...guides, ...services].map((i) => `/info/${i.slug}`),
  ];
  for (const route of routes) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200, route);
    const html = await response.text();
    assert.ok(html.includes("<main"), `${route}: main landmark`);
    assert.ok(
      !html.includes('href="#"'),
      `${route}: no dead placeholder links`,
    );
  }
  const assets = [
    ...getProducts().flatMap((p) => p.images.map((i) => i.src)),
    ...getCollections().map((c) => c.image),
    ...slides.map((s) => s.image),
    modelScene.desktop.image,
    modelScene.mobile.image,
    "/images/fallback.svg",
    "/icon.svg",
  ];
  for (const asset of new Set(assets))
    assert.equal(
      (await fetch(`${base}${asset}`, { method: "HEAD" })).status,
      200,
      asset,
    );
  assert.equal((await fetch(`${base}/products/does-not-exist`)).status, 404);
  assert.equal((await fetch(`${base}/info/does-not-exist`)).status, 404);
  console.log(
    `PASS: ${routes.length} page/filter URLs, ${new Set(assets).size} local assets, and two 404 responses.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
