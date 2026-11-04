import { products } from "@/data/products";
import { categories } from "@/data/categories";
import { collections } from "@/data/collections";
import type { Product, ShopQuery } from "./types";
// Data boundary: replace these functions with database/CMS reads later.
export function getProducts(query: ShopQuery = {}): Product[] {
  let result = products.filter(
    (p) =>
      (!query.category || p.category === query.category) &&
      (!query.collection || p.collectionIds.includes(query.collection)) &&
      (query.sale !== "true" || p.isOnSale) &&
      (!query.q ||
        `${p.name} ${p.category}`
          .toLowerCase()
          .includes(query.q.trim().toLowerCase())),
  );
  if (query.sort === "newest")
    result = [...result].sort((a, b) =>
      b.releasedAt.localeCompare(a.releasedAt),
    );
  if (query.sort === "price-asc")
    result = [...result].sort((a, b) => a.price - b.price);
  if (query.sort === "price-desc")
    result = [...result].sort((a, b) => b.price - a.price);
  return result;
}
export function getProduct(slug: string) {
  return products.find((p) => p.slug === slug);
}
export function getNewArrivals() {
  return getProducts({ sort: "newest" })
    .filter((p) => p.isNew)
    .slice(0, 8);
}
export function getDeals() {
  return getProducts({ sale: "true" }).slice(0, 8);
}
export function getCategories() {
  return categories;
}
export function getCollections() {
  return collections;
}
export function money(price: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(price);
}
export function discount(p: Pick<Product, "price" | "compareAtPrice">) {
  return p.compareAtPrice && p.compareAtPrice > p.price
    ? Math.round((1 - p.price / p.compareAtPrice) * 100)
    : 0;
}
