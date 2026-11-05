import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { database } from "./db";
import { trustedOrigins } from "./origins";
const secret = process.env.BETTER_AUTH_SECRET;
if (!secret || Buffer.byteLength(secret) < 32)
  throw new Error(
    "BETTER_AUTH_SECRET is missing or too short. Run db:setup or restore your private environment file.",
  );
export const auth = betterAuth({
  database: prismaAdapter(database(), { provider: "postgresql" }),
  baseURL: process.env.BETTER_AUTH_URL || "http://127.0.0.1:3000",
  secret,
  trustedOrigins: trustedOrigins(),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  user: {
    additionalFields: {
      role: { type: "string", defaultValue: "admin", input: false },
      active: { type: "boolean", defaultValue: true, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 30,
    cookieCache: { enabled: false },
  },
  advanced: {
    cookiePrefix:
      process.env.FORME_TEST_DIST_DIR === ".next-operations-test"
        ? "forme-operations-test"
        : "better-auth",
    useSecureCookies: process.env.NODE_ENV === "production",
    ipAddress: { ipAddressHeaders: [] },
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: { "/sign-in/email": { window: 60, max: 5 } },
  },
});
