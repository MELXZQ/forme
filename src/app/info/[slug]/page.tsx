import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { guides, services } from "@/data/services";
import { Icon } from "@/components/Icon";
import s from "@/components/Site.module.css";
export const dynamicParams = false;
const entries = [...guides, ...services];
export function generateStaticParams() {
  return entries.map((p) => ({ slug: p.slug }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: entries.find((p) => p.slug === slug)?.title || "Information",
  };
}
export default async function InfoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const slug = (await params).slug;
  const content = entries.find((p) => p.slug === slug);
  if (!content) notFound();
  return (
    <main id="main" className={s.infoPage}>
      <div className={s.breadcrumb}>
        <Link href="/">Home</Link>
        <span>/</span>
        <span>{content.label}</span>
      </div>
      <div className={s.infoBody}>
        <p className={s.eyebrow}>THE SMALL PRINT & GOOD ADVICE</p>
        <h1>{content.title}</h1>
        <p className={s.infoIntro}>{content.intro}</p>
        {content.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <Link href="/shop" className={s.inlineLink}>
          Back to the everyday edit <Icon name="arrow" size={17} />
        </Link>
      </div>
    </main>
  );
}
