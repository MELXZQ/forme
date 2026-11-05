import "server-only";
import { after } from "next/server";
import { runNotificationCheck } from "./engine";
export function scheduleNotificationCheck() {
  after(async () => {
    try {
      await runNotificationCheck();
    } catch {
      console.error(
        "Notification check deferred; persistent job will retry. Review notification task status.",
      );
    }
  });
}
