import type { ModelMarker } from "@/lib/types";
// Coordinates are percentages of the model canvas (including its label space).
// Swap the SVG independently of the scrolling controller in ModelExplorer.tsx.
export const modelScene = {
  desktop: {
    image: "/images/model-desktop.svg",
    alt: "Illustrated model wearing earrings, a necklace, bracelet and rings",
    objectPosition: "50% 50%",
  },
  mobile: {
    image: "/images/model-mobile.svg",
    alt: "Close composition of an illustrated model showing jewellery placement",
    objectPosition: "50% 50%",
  },
  markers: [
    {
      id: "earrings",
      order: 0,
      desktop: { anchor: [45, 24], label: [13, 21] },
      mobile: { anchor: [43, 24], label: [2, 9] },
    },
    {
      id: "piercing",
      order: 1,
      desktop: { anchor: [51, 22], label: [73, 15] },
      mobile: { anchor: [51, 22], label: [58, 9] },
    },
    {
      id: "necklaces",
      order: 2,
      desktop: { anchor: [50, 42], label: [75, 43] },
      mobile: { anchor: [50, 42], label: [63, 38] },
    },
    {
      id: "bracelets",
      order: 3,
      desktop: { anchor: [61, 69], label: [74, 71] },
      mobile: { anchor: [65, 69], label: [63, 83] },
    },
    {
      id: "rings",
      order: 4,
      desktop: { anchor: [42, 65], label: [14, 66] },
      mobile: { anchor: [39, 65], label: [2, 64] },
    },
  ] satisfies ModelMarker[],
};
