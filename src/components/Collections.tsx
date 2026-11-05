import Link from "next/link";
import { getCollections } from "@/lib/catalog";
import { Asset } from "./Asset";
import { Icon } from "./Icon";
import s from "./Site.module.css";
export async function Collections() {
  const collections = await getCollections(true);
  if (!collections.length) return null;
  return (
    <section
      className={s.collections}
      id="collections"
      aria-labelledby="collections-title"
    >
      <div className={s.sectionHeading}>
        <div>
          <p className={s.eyebrow}>PIECES WITH A SHARED POINT OF VIEW</p>
          <h2 id="collections-title">
            In good company<span className={s.headingDot}>.</span>
          </h2>
        </div>
        <span className={s.collectionCount}>
          {String(collections.length).padStart(2, "0")} COLLECTIONS
        </span>
      </div>
      {collections.map((c, i) => (
        <article
          key={c.id}
          className={`${s.collectionRow} ${i % 2 ? s.collectionReverse : ""}`}
        >
          <Link
            href={`/shop?collection=${c.slug}`}
            className={s.collectionImage}
          >
            <Asset src={c.image} alt={c.alt} width={900} height={620} />
          </Link>
          <div className={s.collectionCopy}>
            <p className={s.eyebrow}>{c.eyebrow}</p>
            <h3>{c.name}</h3>
            <p>{c.description}</p>
            <Link className={s.inlineLink} href={`/shop?collection=${c.slug}`}>
              Explore Collection <Icon name="arrow" size={17} />
            </Link>
          </div>
        </article>
      ))}
    </section>
  );
}
