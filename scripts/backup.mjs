import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
config({ path: ".env.local", quiet: true });
if (!process.env.DIRECT_URL)
  throw new Error("Run db:setup or restore .env.local first.");
const url = new URL(process.env.DIRECT_URL),
  folder = path.resolve(
    "backups",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
await fs.mkdir(folder, { recursive: true, mode: 0o700 });
try {
  execFileSync(
    path.join(
      process.env.POSTGRES_BIN || "/opt/homebrew/opt/postgresql@17/bin",
      "pg_dump",
    ),
    [
      "--format=custom",
      "--no-owner",
      "--file",
      path.join(folder, "database.dump"),
    ],
    {
      env: {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port,
        PGDATABASE: url.pathname.slice(1),
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  await fs.chmod(path.join(folder, "database.dump"), 0o600);
  const source = path.resolve(process.env.STORAGE_DIR || ".local/uploads");
  await fs.mkdir(source, { recursive: true, mode: 0o700 });
  await fs.cp(source, path.join(folder, "uploads"), { recursive: true });
  await fs.copyFile(".env.local", path.join(folder, ".env.local"));
  await fs.chmod(path.join(folder, ".env.local"), 0o600);
  console.log(
    `Backup complete: ${folder}\nContains database.dump, uploads, and private .env.local. Keep this directory private.`,
  );
} catch {
  console.error(
    "Backup failed. Ensure the local database is running. No credentials were printed.",
  );
  process.exitCode = 1;
}
