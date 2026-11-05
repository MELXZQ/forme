import { config } from "dotenv";
import { execFileSync } from "node:child_process";
config({ path: ".local/operations-test.env", quiet: true });
if (
  !process.env.DATABASE_URL ||
  new URL(process.env.DATABASE_URL).pathname !== "/forme_operations_test"
)
  throw new Error(
    "Run the isolated operations tests first. This launcher only serves the disposable test database.",
  );
execFileSync(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3002",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "development",
      FORME_TEST_DIST_DIR: ".next-operations-test",
    },
  },
);
