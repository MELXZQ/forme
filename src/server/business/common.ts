import "server-only";
import { z } from "zod";
import { database } from "../db";
import { HttpError } from "../errors";
import {
  owner,
  staff,
  command,
  audit,
  lock,
  type Actor,
  type Tx,
} from "../operations/core";
export { command, audit, lock, owner, type Actor, type Tx };
export const currencies = z.enum(["AUD", "CNY", "USD", "EUR", "GBP"]);
export const money = z.number().int().min(0).max(1_000_000_000);
export const qty = z.number().int().min(0).max(1_000_000);
export const ident = z.string().min(1).max(120);
export const text = z.string().trim().max(2000).default("");
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Choose a valid date",
  );
export const occurred = z
  .string()
  .datetime({ offset: true })
  .refine(
    (s) => Date.parse(s) <= Date.now() + 60000,
    "Actual event cannot be in the future",
  );
export const base = {
  key: z.string().min(8).max(100),
  reason: z.string().trim().min(3).max(2000),
};
export const zone = z.enum(["Asia/Shanghai", "Australia/Melbourne"]);
export const url = z
  .string()
  .max(1000)
  .refine(
    (v) =>
      !v ||
      (/^https?:\/\//.test(v) &&
        (() => {
          try {
            const u = new URL(v);
            return !u.username && !u.password;
          } catch {
            return false;
          }
        })()),
    "Use an HTTP(S) URL without credentials",
  )
  .default("");
export const capabilities = [
  "procurement",
  "finance",
  "recurring",
  "logistics",
  "orderStats",
  "orderExport",
  "customerExport",
  "aftercare",
  "compensationApply",
  "compensationExecute",
  "orderRules",
] as const;
export async function allowed(
  actor: Actor,
  capability: string,
  tx = database() as unknown as Tx,
) {
  staff(actor);
  if (actor.role === "admin") return true;
  return !!(await tx.businessGrant.findUnique({
    where: { userId_capability: { userId: actor.id, capability } },
  }));
}
export async function permit(actor: Actor, capability: string, tx?: Tx) {
  if (!(await allowed(actor, capability, tx)))
    throw new HttpError(
      403,
      "Owner or an explicit business permission is required.",
    );
}
export async function assignee(tx: Tx, id: string) {
  if (
    !(await tx.user.findFirst({
      where: {
        id,
        active: true,
        role: { in: ["admin", "warehouse", "viewer"] },
      },
    }))
  )
    throw new HttpError(400, "Choose an active staff member.");
}
export function safeAmount(n: number) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000_000)
    throw new HttpError(400, "Total amount is outside the supported range.");
  return n;
}
export function reportAmount(
  amount: number,
  currency: string,
  rate: number | null | undefined,
) {
  if (currency === "AUD") return amount;
  if (!rate) return null;
  return safeAmount(
    Number((BigInt(amount) * BigInt(rate) + BigInt(500000)) / BigInt(1000000)),
  );
}
export const rateFields = {
  rateMicros: z
    .number()
    .int()
    .min(1)
    .max(1_000_000_000)
    .nullable()
    .default(null),
  rateDate: day.nullable().default(null),
  rateSource: text,
};
export function rateCheck(v: {
  currency: string;
  rateMicros: number | null;
  rateDate: string | null;
  rateSource: string;
}) {
  if (
    v.currency !== "AUD" &&
    v.rateMicros &&
    (!v.rateDate || !v.rateSource.trim())
  )
    throw new HttpError(400, "A conversion rate needs its date and source.");
}
export const date = (d: string | null | undefined) =>
  d ? new Date(d + "T00:00:00Z") : null;
export const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
export function version(actual: number, expected: number) {
  if (actual !== expected)
    throw new HttpError(409, "This record changed. Refresh before editing.");
}
export async function history(tx: Tx, type: string, id: string) {
  return tx.auditLog.findMany({
    where: { objectType: type, objectId: id },
    orderBy: { createdAt: "asc" },
  });
}
export function cashTotals(
  rows: {
    kind: string;
    status: string;
    source: string;
    amount: number;
    correctionOf: string | null;
    id: string;
  }[],
  includeTest = false,
) {
  const active = rows.filter(
    (r) => r.status === "CONFIRMED" && (includeTest || r.source !== "TEST"),
  );
  const reversed = new Set(
    active.filter((r) => r.kind === "REVERSAL").map((r) => r.correctionOf),
  );
  const paid = active
      .filter((r) => r.kind === "PAYMENT" && !reversed.has(r.id))
      .reduce((n, r) => n + r.amount, 0),
    refund = active
      .filter((r) => r.kind === "REFUND" && !reversed.has(r.id))
      .reduce((n, r) => n + r.amount, 0);
  return { paid, refund, net: paid - refund };
}
