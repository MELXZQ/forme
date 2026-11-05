import { Carousel } from "@/components/Carousel";
import { ProductRail } from "@/components/ProductRail";
import { ModelExplorer } from "@/components/ModelExplorer";
import { Collections } from "@/components/Collections";
import { Guides } from "@/components/Footer";
import { getDeals, getNewArrivals, getHome } from "@/lib/catalog";
export default async function Home() {
  const [arrivals, deals, home] = await Promise.all([
    getNewArrivals(),
    getDeals(),
    getHome(),
  ]);
  return (
    <main id="main">
      <Carousel slides={home.slides} />
      <ProductRail
        title="New arrivals"
        subtitle="FRESH INTO THE ROTATION"
        products={arrivals}
        href="/shop?sort=newest"
      />
      <ProductRail
        title="Good finds"
        subtitle="THE SAME ENERGY. A LITTLE LESS."
        products={deals}
        href="/shop?sale=true"
        sale
      />
      <ModelExplorer modelScene={home.modelScene} />
      <Collections />
      <Guides />
    </main>
  );
}
