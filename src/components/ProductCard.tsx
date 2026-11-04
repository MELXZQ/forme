import Link from "next/link";
import type { Product } from "@/lib/types";
import { money, discount } from "@/lib/catalog";
import { Asset } from "./Asset";
import { Icon } from "./Icon";
import s from "./Site.module.css";
export function ProductCard({
  product: p,
  sale = false,
  eager = false,
}: {
  product: Product;
  sale?: boolean;
  eager?: boolean;
}) {
  return (
    <article className={s.productCard}>
      <Link
        href={`/products/${p.slug}`}
        className={s.productImage}
        aria-label={`View ${p.name}`}
      >
        <Asset
          src={p.images[0]?.src || "/images/fallback.svg"}
          alt={p.images[0]?.alt || p.name}
          priority={eager}
        />
        {sale && discount(p) > 0 ? (
          <span className={s.saleBadge}>−{discount(p)}%</span>
        ) : p.isNew ? (
          <span className={s.newBadge}>NEW</span>
        ) : null}
        <span className={s.productArrow}>
          <Icon name="arrow" size={16} />
        </span>
      </Link>
      <div className={s.productInfo}>
        <h3>
          <Link href={`/products/${p.slug}`}>{p.name}</Link>
        </h3>
        <p>
          <span>{money(p.price)}</span>
          {p.compareAtPrice && p.compareAtPrice > p.price && (
            <del>{money(p.compareAtPrice)}</del>
          )}
          <span className={s.priceCurrency}> AUD</span>
        </p>
      </div>
    </article>
  );
}
