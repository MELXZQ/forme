"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { brand, navigation } from "@/data/brand";
import { categories } from "@/data/categories";
import { useStore } from "./StoreProvider";
import { Icon } from "./Icon";
import s from "./Site.module.css";
export function Header() {
  const { bag, setPanel } = useStore();
  const shop = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape" && shop.current?.open) {
        shop.current.open = false;
        shop.current.querySelector("summary")?.focus();
      }
    };
    const outside = (e: PointerEvent) => {
      if (shop.current && !shop.current.contains(e.target as Node))
        shop.current.open = false;
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", outside);
    };
  }, []);
  return (
    <header className={s.header}>
      <button
        className={`${s.iconButton} ${s.mobileOnly}`}
        onClick={() => setPanel("menu")}
        aria-label="Open navigation"
      >
        <Icon name="menu" />
      </button>
      <Link className={s.logo} href="/" aria-label={`${brand.name} home`}>
        {brand.name}
        <span className={s.logoDot}>.</span>
      </Link>
      <nav className={s.desktopNav} aria-label="Main navigation">
        <details
          ref={shop}
          className={s.shopMenu}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              e.currentTarget.open = false;
          }}
        >
          <summary>
            Shop <span aria-hidden="true">⌄</span>
          </summary>
          <div className={s.dropdown}>
            <Link
              onClick={() => {
                if (shop.current) shop.current.open = false;
              }}
              href="/shop"
            >
              Shop all jewellery <Icon name="arrow" size={16} />
            </Link>
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/shop?category=${c.id}`}
                onClick={() => {
                  if (shop.current) shop.current.open = false;
                }}
              >
                {c.name}
              </Link>
            ))}
          </div>
        </details>
        {navigation.map((n) => (
          <Link key={n.label} href={n.href}>
            {n.label}
          </Link>
        ))}
      </nav>
      <div className={s.headerActions}>
        <span className={s.currency}>AU / AUD</span>
        <button
          className={s.iconButton}
          onClick={() => setPanel("search")}
          aria-label="Search jewellery"
        >
          <Icon name="search" />
        </button>
        <button
          className={s.iconButton}
          onClick={() => setPanel("bag")}
          aria-label={`Open shopping bag, ${bag.reduce((n, p) => n + p.quantity, 0)} items`}
        >
          <Icon name="bag" />
          <span className={s.bagCount}>
            {bag.reduce((n, p) => n + p.quantity, 0)}
          </span>
        </button>
      </div>
    </header>
  );
}
