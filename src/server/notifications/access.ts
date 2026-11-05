import "server-only";
import type { Notification } from "@/generated/prisma/client";
import type { Actor, Tx } from "../operations/core";
import { HttpError } from "../errors";
export function relatedPermission(
  role: string,
  type: string,
  warehouse: string | null,
  capabilities: string[] = [],
) {
  return (
    role === "admin" ||
    (type === "FINANCE" && capabilities.includes("finance")) ||
    (type === "PROCUREMENT" && capabilities.includes("procurement")) ||
    ((role === "warehouse" || role === "viewer") &&
      ((type === "LOGISTICS" && warehouse !== "BEIJING") ||
        (type === "INVENTORY" && warehouse !== "BEIJING")))
  );
}
export function canView(
  actor: Actor,
  n: Pick<Notification, "type" | "warehouse" | "recipientIds">,
) {
  return (
    relatedPermission(actor.role, n.type, n.warehouse, actor.capabilities) &&
    (actor.role === "admin" || n.recipientIds.includes(actor.id))
  );
}
export async function validatePeople(
  tx: Tx,
  type: string,
  warehouse: string | null,
  ids: string[],
) {
  const unique = [...new Set(ids)];
  const users = await tx.user.findMany({
    where: { id: { in: unique }, active: true },
    select: { id: true, role: true },
  });
  const grants = await tx.businessGrant.findMany({
    where: { userId: { in: unique } },
  });
  if (
    users.length !== unique.length ||
    users.some(
      (u) =>
        !relatedPermission(
          u.role,
          type,
          warehouse,
          grants.filter((g) => g.userId === u.id).map((g) => g.capability),
        ),
    )
  )
    throw new HttpError(
      400,
      "Choose active people with permission to view this business record.",
    );
  return users;
}
export function redact(n: Notification, actor: Actor) {
  if (actor.role === "admin") return n;
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([k]) =>
              !["beijing", "beijingAvailable", "legacyRemaining"].includes(k),
          )
          .map(([k, v]) => [k, clean(v)]),
      );
    return value;
  };
  return {
    ...n,
    snapshot: clean(n.snapshot),
    currentData: clean(n.currentData),
    ruleSnapshot: { version: n.ruleVersion },
  };
}
export function internalLink(n: Pick<Notification, "objectType" | "objectId">) {
  const id = encodeURIComponent(n.objectId);
  if (n.objectType === "recurring")
    return `/admin/business?section=recurring&id=${id}`;
  if (n.objectType === "purchase")
    return `/admin/business?section=purchases&id=${id}`;
  if (n.objectType === "expense")
    return `/admin/business?section=expenses&id=${id}`;
  if (n.objectType === "parcel")
    return `/admin/business?section=logistics&id=${id}`;
  if (n.objectType === "sku")
    return `/admin/operations?section=inventory&id=${id}`;
  if (n.objectType === "transfer")
    return `/admin/operations?section=transfers&id=${id}`;
  if (n.objectType === "products" || n.objectType === "product")
    return "/admin?catalogue=1";
  return "/admin/notifications?view=rules";
}
