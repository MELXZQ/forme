import { Carousel } from "@/components/Carousel";
import { ProductRail } from "@/components/ProductRail";
import { ModelExplorer } from "@/components/ModelExplorer";
import { Collections } from "@/components/Collections";
import { Guides } from "@/components/Footer";
import { getDeals, getNewArrivals } from "@/lib/catalog";
export default function Home() {
  return (
    <main id="main">
      <Carousel />
      <ProductRail
        title="New arrivals"
        subtitle="FRESH INTO THE ROTATION"
        products={getNewArrivals()}
        href="/shop?sort=newest"
      />
      <ProductRail
        title="Good finds"
        subtitle="THE SAME ENERGY. A LITTLE LESS."
        products={getDeals()}
        href="/shop?sale=true"
        sale
      />
      <ModelExplorer />
      <Collections />
      <Guides />
    </main>
  );
}
