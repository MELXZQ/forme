import "server-only";
import { database } from "../db";
import { available } from "./inventory";
import { remaining } from "./transfers";
export type Availability = {
  stock: number;
  status: "IN_STOCK" | "RESTOCKING_SOON" | "RESTOCK_PLANNED" | "OUT_OF_STOCK";
  etaStart: string | null;
  etaEnd: string | null;
};
export function melbourneToday(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => p.find((v) => v.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function statusFor(
  stock: number,
  transit: number,
  beijing: number,
  show = true,
): Availability["status"] {
  if (stock > 0) return "IN_STOCK";
  if (show && transit > 0) return "RESTOCKING_SOON";
  if (show && beijing > 0) return "RESTOCK_PLANNED";
  return "OUT_OF_STOCK";
}
export async function publicAvailability(
  ids: string[],
): Promise<Map<string, Availability>> {
  if (!ids.length) return new Map();
  const [balances, policies, lines] = await database().$transaction(
    [
      database().inventoryBalance.findMany({
        where: { variantId: { in: ids } },
      }),
      database().skuPolicy.findMany({ where: { variantId: { in: ids } } }),
      database().transferLine.findMany({
        where: {
          variantId: { in: ids },
          transfer: {
            status: { in: ["SENT", "PARTIAL"] },
            exception: false,
            showRestocking: true,
          },
        },
        include: { transfer: { select: { etaStart: true, etaEnd: true } } },
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  const today = melbourneToday();
  return new Map(
    ids.map((id) => {
      const mel = balances.find(
          (b) => b.variantId === id && b.warehouse === "MELBOURNE",
        ),
        bj = balances.find(
          (b) => b.variantId === id && b.warehouse === "BEIJING",
        );
      const active = lines.filter(
        (l) => l.variantId === id && remaining(l) > 0,
      );
      const show =
        policies.find((p) => p.variantId === id)?.showRestocking ?? true;
      const stock = mel ? available(mel) : 0;
      const status = statusFor(
        stock,
        active.reduce((n, l) => n + remaining(l), 0),
        bj ? available(bj) : 0,
        show,
      );
      const eta = active
        .filter(
          (l) =>
            l.transfer.etaStart &&
            l.transfer.etaEnd &&
            l.transfer.etaEnd.toISOString().slice(0, 10) >= today,
        )
        .sort(
          (a, b) => a.transfer.etaEnd!.getTime() - b.transfer.etaEnd!.getTime(),
        )[0]?.transfer;
      return [
        id,
        {
          stock,
          status,
          etaStart:
            status === "RESTOCKING_SOON" && eta
              ? eta.etaStart!.toISOString().slice(0, 10)
              : null,
          etaEnd:
            status === "RESTOCKING_SOON" && eta
              ? eta.etaEnd!.toISOString().slice(0, 10)
              : null,
        },
      ];
    }),
  );
}
