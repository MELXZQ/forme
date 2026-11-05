import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { HttpError } from "@/server/errors";
import { requireStaff } from "@/server/operations/accounts";
import { operationsEnabled } from "@/server/operations/enabled";
import { OperationsApp } from "@/components/operations/OperationsApp";
export const dynamic = "force-dynamic";
export default async function OperationsPage() {
  let actor;
  try {
    actor = await requireStaff(await headers());
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect("/admin/login");
    if (e instanceof HttpError && e.status === 403)
      return (
        <main id="main" style={{ padding: 40 }}>
          This account does not have staff access.
        </main>
      );
    throw e;
  }
  if (!operationsEnabled())
    return (
      <main id="main" style={{ padding: 40 }}>
        Operations are not enabled in this local process. Complete the approved
        inventory migration before enabling the operations setting.
      </main>
    );
  return (
    <OperationsApp
      actor={{
        id: actor.id,
        role: actor.role as "admin" | "warehouse" | "viewer",
      }}
    />
  );
}
