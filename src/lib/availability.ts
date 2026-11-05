export type AvailabilityStatus =
  "IN_STOCK" | "RESTOCKING_SOON" | "RESTOCK_PLANNED" | "OUT_OF_STOCK";
export type PublicAvailability = {
  stock: number;
  status: AvailabilityStatus;
  etaStart: string | null;
  etaEnd: string | null;
};
export function availabilityLabel(status: AvailabilityStatus) {
  return {
    IN_STOCK: "In stock · Ships from Melbourne",
    RESTOCKING_SOON: "Restocking soon",
    RESTOCK_PLANNED: "Restock planned",
    OUT_OF_STOCK: "Out of stock",
  }[status];
}
export function aggregateAvailability(
  values: AvailabilityStatus[],
): AvailabilityStatus {
  return (
    (["IN_STOCK", "RESTOCKING_SOON", "RESTOCK_PLANNED"] as const).find((s) =>
      values.includes(s),
    ) ?? "OUT_OF_STOCK"
  );
}
export function etaLabel(start: string, end: string) {
  const format = new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `Expected in Melbourne ${format.format(new Date(start))}–${format.format(new Date(end))}. This is not a customer delivery date.`;
}
