import "server-only";
import { database } from "../db";

// Existing records use different provenance fields. Do not infer test data from names.
// Unmarked manual inventory/transfer records belong to their current workspace.
export async function nonRealRecordIds() {
  const db = database();
  const [orders, cases, compensations, expenses] = await Promise.all([
    db.shopOrder.findMany({
      where: { dataKind: { not: "REAL" } },
      select: { id: true, dataKind: true },
    }),
    db.aftercareCase.findMany({
      where: { order: { dataKind: { not: "REAL" } } },
      select: { id: true, order: { select: { dataKind: true } } },
    }),
    db.compensation.findMany({
      where: { order: { dataKind: { not: "REAL" } } },
      select: { id: true, order: { select: { dataKind: true } } },
    }),
    db.expense.findMany({
      select: {
        id: true,
        source: true,
        purchaseId: true,
        links: { select: { objectType: true, objectId: true } },
      },
    }),
  ]);
  const kinds = new Map(orders.map((o) => ["order:" + o.id, o.dataKind]));
  for (const c of cases) kinds.set("case:" + c.id, c.order.dataKind);
  for (const c of compensations)
    kinds.set("compensation:" + c.id, c.order.dataKind);
  for (const e of expenses) {
    const linked = e.links.map((l) =>
      kinds.get(`${l.objectType}:${l.objectId}`),
    );
    const kind =
      e.source === "TEST" || linked.includes("TEST")
        ? "TEST"
        : linked.includes("UNKNOWN")
          ? "UNKNOWN"
          : null;
    if (kind) {
      kinds.set("expense:" + e.id, kind);
      if (e.purchaseId) kinds.set("purchase:" + e.purchaseId, kind);
    }
  }
  const orderIds = orders.map((o) => o.id),
    purchaseIds = [...kinds.keys()]
      .filter((key) => key.startsWith("purchase:"))
      .map((key) => key.slice(9));
  const linkedParcels =
    orderIds.length || purchaseIds.length
      ? await db.parcel.findMany({
          where: {
            OR: [
              { orderId: { in: orderIds } },
              { purchaseId: { in: purchaseIds } },
            ],
          },
          select: { id: true, orderId: true, purchaseId: true },
        })
      : [];
  for (const p of linkedParcels)
    kinds.set(
      "parcel:" + p.id,
      kinds.get("order:" + p.orderId) ||
        kinds.get("purchase:" + p.purchaseId) ||
        "UNKNOWN",
    );
  return kinds;
}
