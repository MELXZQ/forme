export function money(cents: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
export function discount(p: {
  priceCents: number;
  compareAtPriceCents?: number | null;
}) {
  return p.compareAtPriceCents && p.compareAtPriceCents > p.priceCents
    ? Math.round((1 - p.priceCents / p.compareAtPriceCents) * 100)
    : 0;
}
