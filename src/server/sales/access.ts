import "server-only";
import { database } from "../db";
import { HttpError } from "../errors";
import { staff, type Actor, type Tx } from "../operations/core";
import { allowed, permit } from "../business/common";
export { permit };
export async function accessOrder(
  actor: Actor,
  id: string,
  tx: Tx = database(),
) {
  staff(actor);
  if (actor.role === "viewer")
    throw new HttpError(403, "Order access is not granted to viewers");
  const o = await tx.shopOrder.findUnique({
    where: { id },
    include: { lines: true, reservations: true },
  });
  if (
    !o ||
    (actor.role === "warehouse" &&
      (o.paymentStatus !== "PAID" || o.fulfillmentStatus === "CANCELLED"))
  )
    throw new HttpError(404, "Order not found");
  return o;
}
export async function caseAccess(
  actor: Actor,
  id: string,
  tx: Tx = database(),
) {
  const c = await tx.aftercareCase.findUniqueOrThrow({ where: { id } });
  await accessOrder(actor, c.orderId, tx);
  if (
    actor.role !== "admin" &&
    c.assigneeId !== actor.id &&
    !(await allowed(actor, "aftercare", tx))
  )
    throw new HttpError(
      403,
      "Only the assigned handler or an authorized owner can access this case",
    );
  return c;
}
export async function compensationAccess(
  actor: Actor,
  id: string,
  tx: Tx = database(),
) {
  const c = await tx.compensation.findUniqueOrThrow({ where: { id } });
  await caseAccess(actor, c.caseId, tx);
  return c;
}
