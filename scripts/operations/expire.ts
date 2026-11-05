import { database } from "../../src/server/db";
import { operationsEnabled } from "../../src/server/operations/enabled";
import { expireOrders } from "../../src/server/operations/orders";
import { runNotificationCheck } from "../../src/server/notifications/engine";
const db = database();
let running = false,
  stopping = false;
async function tick() {
  if (running || stopping) return;
  running = true;
  try {
    const result = await expireOrders();
    if (result.released || !process.argv.includes("--watch"))
      console.log(`Reservation expiry: ${result.released} orders released.`);
  } catch {
    console.error(
      "Reservation expiry failed. Check the local database. No customer data or credentials were logged.",
    );
    if (!process.argv.includes("--watch")) process.exitCode = 1;
  } finally {
    try {
      await runNotificationCheck();
    } catch {
      console.error(
        "Notification check failed. Review Rules / task status; persisted work will retry.",
      );
    }
    running = false;
  }
}
async function main() {
  if (!operationsEnabled()) {
    console.error(
      "Operations are not enabled. Apply the approved migrations and enable operations first.",
    );
    process.exitCode = 1;
    await db.$disconnect();
  } else {
    await tick();
    if (process.argv.includes("--watch")) {
      console.log(
        "Local reservation expiry worker and notification checks running every 60 seconds. Keep this process open.",
      );
      const timer = setInterval(() => void tick(), 60000);
      const stop = () => {
        if (stopping) return;
        stopping = true;
        clearInterval(timer);
        void db.$disconnect().finally(() => process.exit(0));
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    } else await db.$disconnect();
  }
}
void main().catch(() => {
  console.error(
    "Reservation worker could not start. Check local configuration.",
  );
  process.exitCode = 1;
  void db.$disconnect();
});
