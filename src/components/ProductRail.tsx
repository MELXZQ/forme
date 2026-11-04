"use client";
import { useRef } from "react";
import Link from "next/link";
import type { Product } from "@/lib/types";
import { ProductCard } from "./ProductCard";
import { Icon } from "./Icon";
import s from "./Site.module.css";
export function ProductRail({
  title,
  subtitle,
  products,
  href,
  sale = false,
}: {
  title: string;
  subtitle: string;
  products: Product[];
  href: string;
  sale?: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const move = (dir: number) =>
    rail.current?.scrollBy({
      left: dir * rail.current.clientWidth * 0.8,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  return (
    <section
      className={`${s.railSection} ${sale ? s.deals : ""}`}
      aria-labelledby={sale ? "deals-title" : "new-title"}
    >
      <div className={s.sectionHeading}>
        <div>
          <p className={s.eyebrow}>{subtitle}</p>
          <h2 id={sale ? "deals-title" : "new-title"}>
            {title}
            <span className={s.headingDot}>.</span>
          </h2>
        </div>
        <div className={s.railActions}>
          <Link className={s.inlineLink} href={href}>
            View all <Icon name="arrow" size={16} />
          </Link>
          <div className={s.railButtons}>
            <button
              className={`${s.circleButton} ${s.previous}`}
              onClick={() => move(-1)}
              aria-label={`Browse previous ${title}`}
            >
              <Icon name="arrow" size={17} />
            </button>
            <button
              className={s.circleButton}
              onClick={() => move(1)}
              aria-label={`Browse more ${title}`}
            >
              <Icon name="arrow" size={17} />
            </button>
          </div>
        </div>
      </div>
      <div
        className={s.productRail}
        ref={rail}
        tabIndex={0}
        aria-label={`${title} products, scroll horizontally`}
      >
        {products.length ? (
          products.map((p) => (
            <ProductCard key={p.id} product={p} sale={sale} />
          ))
        ) : (
          <p>New pieces are on their way.</p>
        )}
        <Link className={s.railEnd} href={href}>
          <span>
            There’s more
            <br />
            to your story.
          </span>
          <span>
            View all {title.toLowerCase()} <Icon name="arrow" />
          </span>
        </Link>
      </div>
    </section>
  );
}
