export type CategoryId = string;
export type Category = {
  id: string;
  slug: string;
  name: string;
  short: string;
  description: string;
  sortOrder: number;
};
export type Variant = {
  id: string;
  sku: string;
  size: string;
  color: string;
  priceCents: number;
  compareAtPriceCents?: number | null;
  currency: "AUD";
  stock: number;
  availability?: import("./availability").PublicAvailability;
};
export type Product = {
  id: string;
  slug: string;
  name: string;
  category: string;
  summary: string;
  description: string;
  priceCents: number;
  compareAtPriceCents?: number | null;
  currency: "AUD";
  images: { src: string; alt: string; variantId?: string | null }[];
  isNew: boolean;
  isOnSale: boolean;
  fromPrice: boolean;
  collectionIds: string[];
  releasedAt: string;
  variants: Variant[];
  availability?: import("./availability").AvailabilityStatus;
};
export type ShopQuery = {
  category?: string;
  collection?: string;
  sale?: string;
  sort?: string;
  q?: string;
  page?: string;
  pageSize?: string;
};
export type ProductPage = {
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};
export type Point = [number, number];
export type ModelMarker = {
  id: string;
  name?: string;
  order: number;
  desktop: { anchor: Point; label: Point };
  mobile: { anchor: Point; label: Point };
};
export type ModelScene = {
  desktop: { image: string; alt: string; objectPosition: string };
  mobile: { image: string; alt: string; objectPosition: string };
  markers: ModelMarker[];
};
export type Slide = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
  href: string;
  image: string;
  mobileImage: string;
  position: string;
  mobilePosition: string;
  alt: string;
};
export type Collection = {
  id: string;
  slug: string;
  name: string;
  description: string;
  image: string;
  alt: string;
  eyebrow: string;
};
