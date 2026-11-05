import "server-only";
import { createHash } from "node:crypto";
import { database } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import { HttpError } from "../errors";
export type Tx = Prisma.TransactionClient;
export type Actor = {
  id: string;
  capabilities?: string[];
  role: "admin" | "warehouse" | "viewer" | "guest" | "system";
};
export const owner = (actor: Actor) => {
  if (actor.role !== "admin")
    throw new HttpError(403, "Owner permission is required.");
};
export function staff(actor: Actor, write = false) {
  if (
    !(
      write ? ["admin", "warehouse"] : ["admin", "warehouse", "viewer"]
    ).includes(actor.role)
  )
    throw new HttpError(403, "Staff permission is required.");
}
export function warehouseAccess(
  actor: Actor,
  warehouse: string,
  write = false,
) {
  staff(actor, write);
  if (actor.role === "warehouse" && warehouse !== "MELBOURNE")
    throw new HttpError(
      403,
      "This account is restricted to Melbourne inventory.",
    );
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function lock(tx: Tx, name: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))::text`;
}
export async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  objectType: string,
  objectId: string,
  reason: string,
  before?: unknown,
  after?: unknown,
) {
  return tx.auditLog.create({
    data: {
      actorId: actor.id,
      action,
      objectType,
      objectId,
      reason,
      ...(before == null ? {} : { before: JSON.parse(JSON.stringify(before)) }),
      ...(after == null ? {} : { after: JSON.parse(JSON.stringify(after)) }),
    },
  });
}
export async function command<T>(
  actor: Actor,
  scope: string,
  key: string,
  input: unknown,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key))
    throw new HttpError(
      400,
      "A unique request key (8–100 safe characters) is required.",
    );
  const id = `${scope}:${key}`;
  const fingerprint = createHash("sha256").update(stable(input)).digest("hex");
  return database().$transaction(
    async (tx) => {
      await lock(tx, `command:${id}`);
      const old = await tx.operationCommand.findUnique({ where: { key: id } });
      if (old) {
        if (old.actorId !== actor.id)
          throw new HttpError(
            409,
            "This operation was already submitted by another account.",
          );
        if (old.fingerprint !== fingerprint)
          throw new HttpError(
            409,
            "This request key was already used for different values.",
          );
        return old.result as T;
      }
      const result = await run(tx);
      await tx.operationCommand.create({
        data: {
          key: id,
          fingerprint,
          actorId: actor.id,
          result: JSON.parse(JSON.stringify(result)),
        },
      });
      return result;
    },
    { maxWait: 10000, timeout: 15000 },
  );
}
export function csvCell(value: unknown) {
  let text = String(value ?? "").replace(/[\r\n\t]/g, " ");
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export const csv = (rows: unknown[][]) =>
  "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
