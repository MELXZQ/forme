import { database } from "../../src/server/db";
import { runNotificationCheck } from "../../src/server/notifications/engine";
async function main() {
  try {
    console.log(
      "Notification check:",
      await runNotificationCheck(undefined, true),
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Notification check failed");
    process.exitCode = 1;
  } finally {
    await database().$disconnect();
  }
}
void main();
