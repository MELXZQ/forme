import Link from "next/link";
import { brand } from "@/data/brand";
import { getCategories } from "@/lib/catalog";
import { guides, services } from "@/data/services";
import { Icon } from "./Icon";
import { operationsEnabled } from "@/server/operations/enabled";
import s from "./Site.module.css";
export function Guides() {
  return (
    <section className={s.guides} aria-labelledby="guides-title">
      <div className={s.guideIntro}>
        <p className={s.eyebrow}>A LITTLE GUIDANCE</p>
        <h2 id="guides-title">Details, sorted.</h2>
      </div>
      <div className={s.guideLinks}>
        {guides.map((g) => (
          <Link key={g.slug} href={`/info/${g.slug}`}>
            <span>{g.number}</span>
            <div>
              <strong>{g.label}</strong>
              <p>{g.intro}</p>
            </div>
            <Icon name="arrow" />
          </Link>
        ))}
      </div>
    </section>
  );
}
export async function Footer() {
  const categories = await getCategories();
  return (
    <>
      <section className={s.serviceBar} aria-label="Customer service">
        {services.slice(0, 4).map((item) => (
          <Link href={`/info/${item.slug}`} key={item.slug}>
            {item.label}
            <Icon name="arrow" size={16} />
          </Link>
        ))}
      </section>
      <footer className={s.footer}>
        <div className={s.footerMain}>
          <div className={s.footerBrand}>
            <Link href="/" className={s.logo}>
              {brand.name}
              <span className={s.logoDot}>.</span>
            </Link>
            <p>{brand.description}</p>
            <span className={s.eyebrow}>{brand.descriptor}</span>
          </div>
          <nav aria-label="Shop categories">
            <h2>Explore</h2>
            {categories.map((c) => (
              <Link key={c.id} href={`/shop?category=${c.slug}`}>
                {c.short}
              </Link>
            ))}
          </nav>
          <nav aria-label="Help and information">
            <h2>Good to know</h2>
            {operationsEnabled() && <Link href="/orders">Order lookup</Link>}
            {services.map((item) => (
              <Link key={item.slug} href={`/info/${item.slug}`}>
                {item.label}
                {["privacy", "terms"].includes(item.slug) && (
                  <small> · pending</small>
                )}
              </Link>
            ))}
          </nav>
          <div className={s.footerNote}>
            <h2>A work in progress.</h2>
            <p>
              A concept store, made for exploring. Products and prices are
              illustrative. Shipping and returns policies are pending.
            </p>
            {brand.social.map((n) => (
              <a key={n.url} href={n.url} target="_blank" rel="noreferrer">
                {n.label}
              </a>
            ))}
          </div>
        </div>
        <div className={s.footerBottom}>
          <span>
            © {new Date().getFullYear()} {brand.name}. Concept store.
          </span>
          <span>AUSTRALIA / AUD</span>
          <a href="#top">Back to top ↑</a>
        </div>
      </footer>
    </>
  );
}
