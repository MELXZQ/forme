import { execFileSync, spawn } from "node:child_process";
async function main() {
  const occupied = await fetch("http://127.0.0.1:3002/admin/login").then(
    () => true,
    () => false,
  );
  if (occupied)
    throw new Error(
      "Stop the dedicated test preview on port 3002 before running the full suite.",
    );
  execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/operations/test.mjs",
    ],
    { stdio: "inherit" },
  );
  const server = spawn(
    process.execPath,
    ["scripts/operations/dev-test-server.mjs"],
    { stdio: "ignore", detached: true },
  );
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      ready = await fetch("http://127.0.0.1:3002/admin/login").then(
        (r) => r.ok,
        () => false,
      );
      if (ready) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error("Dedicated test preview did not start.");
    execFileSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "scripts/operations/http.ts",
      ],
      { stdio: "inherit" },
    );
  } finally {
    if (server.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {}
    }
  }
}
main().catch((e) => {
  console.error(
    e instanceof Error && e.message.startsWith("Stop")
      ? e.message
      : "Isolated integration verification failed; see the last check above.",
  );
  process.exitCode = 1;
});
