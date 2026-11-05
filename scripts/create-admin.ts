import { input, password, confirm } from "@inquirer/prompts";
import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";
import { database } from "../src/server/db";
const db = database();
async function main() {
  const email = (
    await input({
      message: "Admin email (local login identity):",
      validate: (v) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || "Enter a valid email.",
    })
  )
    .trim()
    .toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (
      !(await confirm({
        message:
          "This account exists. Replace its password and revoke its sessions?",
        default: false,
      }))
    )
      return;
  }
  const name = await input({
    message: "Admin display name:",
    default: existing?.name || "Administrator",
  });
  const secret = await password({
    message: "Password (12–128 characters, hidden):",
    mask: "*",
    validate: (v) =>
      (v.length >= 12 && v.length <= 128) || "Use 12–128 characters.",
  });
  const again = await password({
    message: "Confirm password (hidden):",
    mask: "*",
  });
  if (secret !== again) throw new Error("Passwords do not match.");
  const hashed = await hashPassword(secret);
  await db.$transaction(async (tx) => {
    const user = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: { name },
        })
      : await tx.user.create({
          data: {
            id: randomUUID(),
            email,
            name,
            emailVerified: true,
            role: "admin",
            active: true,
          },
        });
    await tx.account.upsert({
      where: {
        providerId_accountId: { providerId: "credential", accountId: user.id },
      },
      create: {
        id: randomUUID(),
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: hashed,
      },
      update: { password: hashed },
    });
    await tx.session.deleteMany({ where: { userId: user.id } });
  });
  console.log(
    "Administrator ready. Sign in at http://127.0.0.1:3000/admin. No password was logged.",
  );
}
main()
  .catch((e) => {
    console.error(
      e instanceof Error && e.message === "Passwords do not match."
        ? e.message
        : "Administrator setup cancelled or failed. No credentials were printed.",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
