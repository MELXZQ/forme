export type CategoryId =
  "earrings" | "necklaces" | "bracelets" | "rings" | "piercing";
export type Product = {
  id: string;
  slug: string;
  name: string;
  category: CategoryId;
  price: number;
  compareAtPrice?: number;
  currency: "AUD";
  images: { src: string; alt: string }[];
  isNew: boolean;
  isOnSale: boolean;
  collectionIds: string[];
  releasedAt: string;
  description: string;
};
export type ShopQuery = {
  category?: string;
  collection?: string;
  sale?: string;
  sort?: string;
  q?: string;
};
export type Point = [number, number];
export type ModelMarker = {
  id: CategoryId;
  order: number;
  desktop: { anchor: Point; label: Point };
  mobile: { anchor: Point; label: Point };
};
