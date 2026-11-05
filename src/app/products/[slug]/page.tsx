import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getProduct, getProducts, getCategories } from "@/lib/catalog";
import { Asset } from "@/components/Asset";
import { ProductPurchase } from "@/components/ProductPurchase";
import { ProductRail } from "@/components/ProductRail";
import s from "@/components/Site.module.css";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const p = await getProduct((await params).slug);
  return { title: p?.name || "Piece not found" };
}
export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const p = await getProduct((await params).slug);
  if (!p) notFound();
  const category = (await getCategories()).find((c) => c.slug === p.category);
  const related = (await getProducts({ category: p.category })).filter(
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
            <Asset
              src={p.images[0]?.src || "/images/fallback.svg"}
              alt={p.images[0]?.alt || p.name}
              priority
            />
          </div>
          <div className={s.detailCopy}>
            <p className={s.eyebrow}>
              {p.isNew ? "NEW TO THE ROTATION" : category?.short.toUpperCase()}
            </p>
            <h1>{p.name}</h1>
            <p>{p.summary}</p>
            <p>{p.description}</p>
            <ProductPurchase product={p} />
            <p className={s.muted}>
              {p.availability?"No real payment is connected. Stock is reserved only when you submit checkout.":"Demo bag only. No payment, order or inventory reservation is processed."}
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
