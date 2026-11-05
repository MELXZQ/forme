import "server-only";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { database } from "../db";
import { auth } from "../auth";
import { HttpError } from "../errors";
import { command, owner, lock, audit, type Actor } from "./core";
import { ident, key, reason } from "./validation";
export async function requireStaff(headers: Headers): Promise<Actor> {
  const session = await auth.api.getSession({ headers });
  if (!session) throw new HttpError(401, "Please sign in.");
  if (
    !session.user.active ||
    !["admin", "warehouse", "viewer"].includes(session.user.role)
  )
    throw new HttpError(403, "Staff permission is required.");
  return { id: session.user.id, role: session.user.role as Actor["role"], capabilities: (await database().businessGrant.findMany({where:{userId:session.user.id}})).map(g=>g.capability) };
}
export async function listAccounts(actor: Actor) {
  owner(actor);
  return database().user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
}
const createSchema = z
  .object({
    key,
    name: z.string().trim().min(1).max(150),
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(12).max(128),
    role: z.enum(["admin", "warehouse", "viewer"]),
    reason,
  })
  .strict();
export async function createAccount(actor: Actor, input: unknown) {
  owner(actor);
  const v = createSchema.parse(input);
  const password = await hashPassword(v.password);
  // Password material never enters command fingerprints or audit JSON.
  // Retrying account creation never resets the existing account's password.
  const { password: omittedPassword, ...safeInput } = v;
  void omittedPassword;
  return command(actor, "account-create", v.key, safeInput, async (tx) => {
    const userId = randomUUID();
    const u = await tx.user.create({
      data: {
        id: userId,
        name: v.name,
        email: v.email,
        emailVerified: true,
        role: v.role,
        active: true,
        accounts: {
          create: {
            id: randomUUID(),
            providerId: "credential",
            accountId: userId,
            password,
          },
        },
      },
    });
    await audit(
      tx,
      actor,
      "ACCOUNT_CREATED",
      "user",
      u.id,
      v.reason,
      undefined,
      { name: u.name, role: u.role, active: u.active },
    );
    return { id: u.id };
  });
}
const updateSchema = z
  .object({
    key,
    id: ident,
    role: z.enum(["admin", "warehouse", "viewer"]),
    active: z.boolean(),
    reason,
  })
  .strict();
export async function updateAccount(actor: Actor, input: unknown) {
  owner(actor);
  const v = updateSchema.parse(input);
  return command(actor, "account-update", v.key, v, async (tx) => {
    await lock(tx, "accounts:owners");
    const old = await tx.user.findUnique({ where: { id: v.id } });
    if (!old) throw new HttpError(404, "Account not found.");
    if (
      old.role === "admin" &&
      old.active &&
      (!v.active || v.role !== "admin") &&
      (await tx.user.count({ where: { role: "admin", active: true } })) <= 1
    )
      throw new HttpError(
        409,
        "The last active owner cannot be disabled or demoted.",
      );
    await tx.user.update({
      where: { id: v.id },
      data: { role: v.role, active: v.active },
    });
    await tx.session.deleteMany({ where: { userId: v.id } });
    await audit(
      tx,
      actor,
      "ACCOUNT_PERMISSION_CHANGED",
      "user",
      v.id,
      v.reason,
      { role: old.role, active: old.active },
      { role: v.role, active: v.active },
    );
    return { id: v.id };
  });
}
