import "server-only";
import { config } from "dotenv";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
config({ path: ".env.local", quiet: true });
const globalDb = globalThis as unknown as { formeDb?: PrismaClient };
export function database() {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "DATABASE_URL is missing. Run npm run db:setup and db:migrate.",
    );
  if (!globalDb.formeDb)
    globalDb.formeDb = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        max: 5,
        connectionTimeoutMillis: 5000,
      }),
      log: [],
    });
  return globalDb.formeDb;
}
