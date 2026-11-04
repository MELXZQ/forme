import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getProduct,
  getProducts,
  money,
  discount,
  getCategories,
} from "@/lib/catalog";
import { Asset } from "@/components/Asset";
import { AddToBag } from "@/components/AddToBag";
import { ProductRail } from "@/components/ProductRail";
import s from "@/components/Site.module.css";
export const dynamicParams = false;
export function generateStaticParams() {
  return getProducts().map((p) => ({ slug: p.slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const p = getProduct((await params).slug);
  return { title: p?.name || "Piece not found" };
}
export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const p = getProduct((await params).slug);
  if (!p) notFound();
  const category = getCategories().find((c) => c.id === p.category);
  const related = getProducts({ category: p.category }).filter(
    (item) => item.id !== p.id,
  );
  return (
    <main id="main">
      <div className={s.detailWrap}>
        <div className={s.breadcrumb}>
          <Link href="/">Home</Link>
          <span>/</span>
          <Link href={`/shop?category=${p.category}`}>{category?.short}</Link>
          <span>/</span>
          <span>{p.name}</span>
        </div>
        <div className={s.productDetail}>
          <div className={s.detailImage}>
            <Asset src={p.images[0].src} alt={p.images[0].alt} priority />
          </div>
          <div className={s.detailCopy}>
            <p className={s.eyebrow}>
              {p.isNew ? "NEW TO THE ROTATION" : category?.short.toUpperCase()}
            </p>
            <h1>{p.name}</h1>
            <p className={s.detailPrice}>
              {money(p.price)} <span>AUD</span>
              {p.compareAtPrice && <del>{money(p.compareAtPrice)}</del>}
              {discount(p) > 0 && <small>Save {discount(p)}%</small>}
            </p>
            <p>{p.description}</p>
            <p className={s.demoNote}>
              Concept piece · illustrative image · sample price
            </p>
            <AddToBag id={p.id} />
            <p className={s.muted}>
              No payment or order is processed. Final sizes and materials are
              pending.
            </p>
            <div className={s.detailLinks}>
              <Link
                href={`/info/${p.category === "rings" ? "ring-size" : "necklace-length"}`}
              >
                Size & fit guidance ↗
              </Link>
              <Link href="/info/jewellery-care">Care guidance ↗</Link>
              <Link href="/info/shipping">Shipping — pending ↗</Link>
            </div>
          </div>
        </div>
      </div>
      {related.length > 0 && (
        <ProductRail
          title="In your rotation"
          subtitle="A FEW MORE DETAILS"
          products={related}
          href={`/shop?category=${p.category}`}
        />
      )}
    </main>
  );
}
