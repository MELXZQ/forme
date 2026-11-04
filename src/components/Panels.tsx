"use client";
import { useEffect, useRef } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useStore } from "./StoreProvider";
import { getProducts, money } from "@/lib/catalog";
import { categories } from "@/data/categories";
import { navigation } from "@/data/brand";
import { Icon } from "./Icon";
import { Asset } from "./Asset";
import s from "./Site.module.css";
export function Panels() {
  const { panel, setPanel, bag, change, clear } = useStore();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    setPanel(null);
  }, [pathname, params, setPanel]);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (panel) {
      opener.current = document.activeElement as HTMLElement;
      el.showModal();
      const overflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = overflow;
        el.close();
        opener.current?.focus();
      };
    }
  }, [panel]);
  const products = getProducts();
  const lines = bag.flatMap((item) => {
    const product = products.find((p) => p.id === item.id);
    return product ? [{ ...item, product }] : [];
  });
  return (
    <dialog
      ref={dialog}
      className={s.panel}
      aria-labelledby="panel-title"
      onCancel={() => setPanel(null)}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            setPanel(null);
        }
      }}
    >
      <div className={s.panelHeading}>
        <h2 id="panel-title">
          {panel === "search"
            ? "Find your next detail."
            : panel === "menu"
              ? "Explore FORME."
              : "Your bag"}
        </h2>
        <button
          className={s.iconButton}
          aria-label="Close panel"
          onClick={() => setPanel(null)}
        >
          <Icon name="close" />
        </button>
      </div>
      {panel === "menu" && (
        <nav className={s.mobileNav} aria-label="Mobile navigation">
          <Link href="/shop" onClick={() => setPanel(null)}>
            Shop all <Icon name="arrow" />
          </Link>
          {navigation.map((n) => (
            <Link key={n.label} href={n.href} onClick={() => setPanel(null)}>
              {n.label}
            </Link>
          ))}
          <p className={s.eyebrow}>BY CATEGORY</p>
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/shop?category=${c.id}`}
              onClick={() => setPanel(null)}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      )}
      {panel === "search" && (
        <>
          <form
            action="/shop"
            className={s.searchForm}
            onSubmit={(event) => {
              event.preventDefault();
              const query =
                new FormData(event.currentTarget).get("q")?.toString().trim() ||
                "";
              router.push(`/shop?q=${encodeURIComponent(query)}`);
              setPanel(null);
            }}
          >
            <label htmlFor="search">Search by product name or category</label>
            <div>
              <input
                id="search"
                type="search"
                name="q"
                placeholder="Try rings or chain…"
                autoComplete="off"
                required
              />
              <button className={s.darkButton} aria-label="Submit search">
                <Icon name="search" />
              </button>
            </div>
          </form>
          <p className={s.eyebrow}>A GOOD PLACE TO START</p>
          <div className={s.searchSuggestions}>
            {categories.map((c) => (
              <Link key={c.id} href={`/shop?category=${c.id}`}>
                {c.short}
                <Icon name="arrow" size={16} />
              </Link>
            ))}
          </div>
        </>
      )}
      {panel === "bag" && (
        <>
          <p className={s.demoNote}>
            Demo bag · saved on this device · no checkout
          </p>
          {lines.length === 0 ? (
            <div className={s.emptyState}>
              <Icon name="bag" size={42} />
              <h3>A little space for self-expression.</h3>
              <p>Your bag is waiting for your everyday favourites.</p>
              <Link
                className={s.darkButton}
                href="/shop"
                onClick={() => setPanel(null)}
              >
                Explore jewellery <Icon name="arrow" size={16} />
              </Link>
            </div>
          ) : (
            <>
              <div className={s.bagLines}>
                {lines.map(({ product: p, quantity }) => (
                  <article key={p.id} className={s.bagLine}>
                    <Link href={`/products/${p.slug}`}>
                      <Asset src={p.images[0].src} alt={p.images[0].alt} />
                    </Link>
                    <div>
                      <Link href={`/products/${p.slug}`}>{p.name}</Link>
                      <p>{money(p.price)} AUD</p>
                      <div className={s.quantity}>
                        <button
                          aria-label={`Remove one ${p.name}`}
                          onClick={() => change(p.id, -1)}
                        >
                          <Icon name="minus" size={14} />
                        </button>
                        <span aria-label="Quantity">{quantity}</span>
                        <button
                          aria-label={`Add one ${p.name}`}
                          onClick={() => change(p.id, 1)}
                          disabled={quantity >= 99}
                        >
                          <Icon name="plus" size={14} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <div className={s.bagTotal}>
                <span>Subtotal</span>
                <strong>
                  {money(
                    lines.reduce((n, p) => n + p.product.price * p.quantity, 0),
                  )}{" "}
                  AUD
                </strong>
              </div>
              <p className={s.muted}>
                This is a preview. No payment or order will be processed.
              </p>
              <button className={s.textButton} onClick={clear}>
                Clear bag
              </button>
            </>
          )}
        </>
      )}
    </dialog>
  );
}
