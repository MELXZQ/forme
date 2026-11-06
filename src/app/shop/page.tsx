import { Select } from "@/components/ui/Select";
import Link from "next/link";
import type { Metadata } from "next";
import { listProducts, getCategories, getCollections } from "@/lib/catalog";
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
  for (const key of [
    "q",
    "category",
    "collection",
    "sale",
    "sort",
    "page",
  ] as const) {
    if (typeof params[key] === "string") query[key] = params[key];
  }
  const [result, categories, collections] = await Promise.all([
    listProducts(query),
    getCategories(),
    getCollections(),
  ]);
  const products = result.items;
  const title = query.q
    ? `Results for “${query.q}”`
    : query.category
      ? categories.find((c) => c.slug === query.category)?.short ||
        "Explore jewellery"
      : query.collection
        ? collections.find((c) => c.slug === query.collection)?.name ||
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
      <FilterForm className={s.filters}>
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
          <Select
            id="category"
            name="category"
            defaultValue={query.category || ""}
          >
            <option value="">All jewellery</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.short}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="collection">Collection</label>
          <Select
            id="collection"
            name="collection"
            defaultValue={query.collection || ""}
          >
            <option value="">All collections</option>
            {collections.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="sort">Sort by</label>
          <Select name="sort" id="sort" defaultValue={query.sort || "featured"}>
            <option value="featured">Featured</option>
            <option value="newest">Newest first</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </Select>
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
          Search <Icon name="search" size={16} />
        </button>
      </FilterForm>
      <div className={s.resultBar}>
        <p aria-live="polite">
          {result.total} {result.total === 1 ? "piece" : "pieces"}
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
      {result.pageCount > 1 && (
        <nav aria-label="Product pages" className={s.pagination}>
          {Array.from({ length: result.pageCount }, (_, index) => {
            const values = new URLSearchParams();
            for (const [name, value] of Object.entries(query))
              if (value) values.set(name, value);
            values.set("page", String(index + 1));
            return (
              <Link
                key={index}
                href={`/shop?${values.toString()}`}
                aria-current={result.page === index + 1 ? "page" : undefined}
              >
                {index + 1}
              </Link>
            );
          })}
        </nav>
      )}
    </main>
  );
}
