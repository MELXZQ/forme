import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";
config({ path: ".env.local", quiet: true });
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node --import tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DIRECT_URL"),
    shadowDatabaseUrl: env("SHADOW_DATABASE_URL"),
  },
});
