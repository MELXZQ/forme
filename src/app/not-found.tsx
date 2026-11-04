import Link from "next/link";
import s from "@/components/Site.module.css";
export default function NotFound() {
  return (
    <main id="main" className={s.emptyState}>
      <p className={s.eyebrow}>404 / A SMALL DETOUR</p>
      <h1>This piece is out of the picture.</h1>
      <p>The page you’re looking for isn’t here.</p>
      <Link href="/shop" className={s.darkButton}>
        Explore jewellery →
      </Link>
    </main>
  );
}
