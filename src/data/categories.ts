import type { CategoryId } from "@/lib/types";
export const categories: { id: CategoryId; name: string; short: string }[] = [
  { id: "earrings", name: "Earrings", short: "Earrings" },
  { id: "necklaces", name: "Necklaces", short: "Necklaces" },
  { id: "bracelets", name: "Bracelets", short: "Bracelets" },
  { id: "rings", name: "Rings", short: "Rings" },
  {
    id: "piercing",
    name: "Other / Piercing Jewellery",
    short: "Piercing Jewellery",
  },
];
