import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const bin = process.env.POSTGRES_BIN || "/opt/homebrew/opt/postgresql@17/bin";
const data = path.resolve(".local/postgres/data"),
  socket = path.resolve(".local/postgres/socket");
const run = (command, args) =>
  execFileSync(path.join(bin, command), args, { stdio: "inherit" });
const status = () => {
  try {
    execFileSync(path.join(bin, "pg_ctl"), ["-D", data, "status"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};
const action = process.argv[2] || "status";
if (action === "start") {
  mkdirSync(socket, { recursive: true, mode: 0o700 });
  if (!existsSync(path.join(data, "PG_VERSION"))) {
    run("initdb", [
      "-D",
      data,
      "--username=forme_bootstrap",
      "--encoding=UTF8",
      "--locale=C",
      "--auth-local=trust",
      "--auth-host=scram-sha-256",
    ]);
    appendFileSync(
      path.join(data, "postgresql.conf"),
      `\nlisten_addresses = '127.0.0.1'\nport = 55432\nunix_socket_directories = '${socket.replaceAll("'", "''")}'\n`,
    );
  }
  if (!status())
    run("pg_ctl", [
      "-D",
      data,
      "-l",
      path.resolve(".local/postgres/server.log"),
      "-w",
      "start",
    ]);
  else console.log("FORME PostgreSQL is already running on 127.0.0.1:55432.");
} else if (action === "stop") {
  if (status()) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
  else console.log("FORME PostgreSQL is stopped.");
} else if (action === "status") {
  console.log(
    status() ? "FORME PostgreSQL is running." : "FORME PostgreSQL is stopped.",
  );
} else
  throw new Error("Use start, stop or status. No reset command is provided.");
