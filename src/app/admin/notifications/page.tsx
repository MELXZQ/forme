import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/server/operations/accounts";
import { HttpError } from "@/server/errors";
import { NotificationApp } from "@/components/notifications/NotificationApp";
export const dynamic = "force-dynamic";
export default async function Page() {
  let actor;
  try {
    actor = await requireStaff(await headers());
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect("/admin/login");
    throw e;
  }
  return <NotificationApp actor={{ id: actor.id, role: actor.role }} />;
}
