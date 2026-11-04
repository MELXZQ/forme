import Link from "next/link";
import type { Metadata } from "next";
import { getProducts, getCategories, getCollections } from "@/lib/catalog";
import type { ShopQuery } from "@/lib/types";
import { ProductCard } from "@/components/ProductCard";
import { Icon } from "@/components/Icon";
import { FilterForm } from "@/components/FilterForm";
import s from "@/components/Site.module.css";
export const metadata: Metadata = { title: "Explore jewellery" };
export default async function Shop({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query: ShopQuery = {};
  for (const key of ["q", "category", "collection", "sale", "sort"] as const) {
    if (typeof params[key] === "string") query[key] = params[key];
  }
  const products = getProducts(query),
    categories = getCategories(),
    collections = getCollections();
  const title = query.q
    ? `Results for “${query.q}”`
    : query.category
      ? categories.find((c) => c.id === query.category)?.short ||
        "Explore jewellery"
      : query.collection
        ? collections.find((c) => c.id === query.collection)?.name ||
          "Explore jewellery"
        : query.sale === "true"
          ? "Good finds"
          : query.sort === "newest"
            ? "New arrivals"
            : "The everyday edit";
  const active = !!(
    query.q ||
    query.category ||
    query.collection ||
    query.sale === "true"
  );
  return (
    <main id="main" className={s.shopPage}>
      <div className={s.breadcrumb}>
        <Link href="/">Home</Link>
        <span>/</span>
        <span>Shop</span>
      </div>
      <div className={s.shopIntro}>
        <p className={s.eyebrow}>YOUR NEXT SIGNATURE</p>
        <h1>
          {title.replace(/\.$/, "")}
          <span className={s.headingDot}>.</span>
        </h1>
        <p>Considered details. Individual expression. All prices in AUD.</p>
      </div>
      <FilterForm className={s.filters} key={JSON.stringify(query)}>
        <div className={s.filterSearch}>
          <label htmlFor="shop-q">Search</label>
          <input
            id="shop-q"
            type="search"
            name="q"
            defaultValue={query.q || ""}
            placeholder="Name or category"
          />
        </div>
        <div>
          <label htmlFor="category">Category</label>
          <select
            id="category"
            name="category"
            defaultValue={query.category || ""}
          >
            <option value="">All jewellery</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.short}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="collection">Collection</label>
          <select
            id="collection"
            name="collection"
            defaultValue={query.collection || ""}
          >
            <option value="">All collections</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sort">Sort by</label>
          <select name="sort" id="sort" defaultValue={query.sort || "featured"}>
            <option value="featured">Featured</option>
            <option value="newest">Newest first</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>
        </div>
        <label className={s.saleCheck}>
          <input
            type="checkbox"
            name="sale"
            value="true"
            defaultChecked={query.sale === "true"}
          />{" "}
          On sale
        </label>
        <button className={s.darkButton} type="submit">
          Apply <Icon name="arrow" size={16} />
        </button>
      </FilterForm>
      <div className={s.resultBar}>
        <p aria-live="polite">
          {products.length} {products.length === 1 ? "piece" : "pieces"}
          {query.sale === "true" ? " · on sale" : ""}
        </p>
        {active && (
          <Link className={s.textButton} href="/shop">
            Clear filters <Icon name="close" size={14} />
          </Link>
        )}
      </div>
      {products.length ? (
        <div className={s.productGrid}>
          {products.map((p, i) => (
            <ProductCard
              key={p.id}
              product={p}
              sale={p.isOnSale}
              eager={i < 4}
            />
          ))}
        </div>
      ) : (
        <div className={s.emptyState}>
          <Icon name="search" size={38} />
          <h2>No pieces found. Yet.</h2>
          <p>Try a different search, or make a little room in your filters.</p>
          <Link className={s.darkButton} href="/shop">
            Clear all filters <Icon name="arrow" size={16} />
          </Link>
        </div>
      )}
    </main>
  );
}
