import "server-only";
import type { Actor, Tx } from "../operations/core";
// Called inside the existing business transaction. Old events are never fabricated.
export async function captureOrderAudit(
  tx: Tx,
  a: {
    id: string;
    action: string;
    objectType: string;
    objectId: string;
    createdAt: Date;
    before: unknown;
    after: unknown;
  },
  actor: Actor,
) {
  if (a.objectType !== "order") return;
  const o = await tx.shopOrder.findUnique({ where: { id: a.objectId } });
  if (!o) return;
  const after = (a.after ?? {}) as Record<string, unknown>;
  const relatedCase =
    typeof after.caseId === "string"
      ? await tx.aftercareCase.findUnique({
          where: { id: after.caseId },
          select: { source: true },
        })
      : typeof after.compensationId === "string"
        ? (
            await tx.compensation.findUnique({
              where: { id: after.compensationId },
              select: { case: { select: { source: true } } },
            })
          )?.case
        : null;
  const source =
    relatedCase?.source === "TEST" ||
    a.action.startsWith("DEV_") ||
    a.action === "LATE_PAYMENT_REVIEW"
      ? "TEST"
      : actor.role === "system" || actor.role === "guest"
        ? "SYSTEM"
        : "MANUAL";
  const paid =
    (a.action === "DEV_PAYMENT_EVENT" && after.result === "PAID") ||
    a.action === "PAYMENT_CONFIRMED";
  const kind = source === "TEST" ? "TEST" : o.dataKind;
  await tx.orderEvent.create({
    data: {
      orderId: o.id,
      type: paid
        ? "PAYMENT_SUCCEEDED"
        : a.action === "DEV_PAYMENT_EVENT"
          ? after.result === "FAILED"
            ? "PAYMENT_FAILED"
            : "PAYMENT_REVIEW"
          : a.action,
      source,
      dataKind: kind,
      occurredAt:
        typeof after.occurredAt === "string"
          ? new Date(after.occurredAt)
          : a.createdAt,
      actorId: actor.id,
      objectType: "order",
      objectId: o.id,
      eventKey: "audit:" + a.id,
      amountCents: paid ? o.totalCents : null,
      ...(a.before == null
        ? {}
        : { before: JSON.parse(JSON.stringify(a.before)) }),
      ...(a.after == null
        ? {}
        : { after: JSON.parse(JSON.stringify(a.after)) }),
    },
  });
}
// Stable largest-remainder allocation: ties use input order, no floating money math.
export function allocate(amount: number, weights: number[]) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    weights.some((x) => !Number.isSafeInteger(x) || x < 0)
  )
    throw new Error("Invalid allocation");
  const total = weights.reduce((a, b) => a + BigInt(b), BigInt(0));
  if (total === BigInt(0)) {
    if (amount) throw new Error("No allocation basis");
    return weights.map(() => 0);
  }
  const shares = weights.map((w, i) => ({
    i,
    n: Number((BigInt(amount) * BigInt(w)) / total),
    r: (BigInt(amount) * BigInt(w)) % total,
  }));
  let left = amount - shares.reduce((n, x) => n + x.n, 0);
  for (const x of [...shares].sort((a, b) =>
    a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1,
  )) {
    if (left-- <= 0) break;
    x.n++;
  }
  return shares.map((x) => x.n);
}
