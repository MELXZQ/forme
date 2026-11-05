import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { HttpError } from "@/server/errors";
import { AdminApp } from "@/components/admin/AdminApp";
import { requireStaff } from "@/server/operations/accounts";
export const dynamic = "force-dynamic";
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ catalogue?: string }>;
}) {
  const query = await searchParams;
  try {
    const actor = await requireStaff(await headers());
    if (query.catalogue !== "1") redirect("/admin/notifications");
    if (actor.role !== "admin") redirect("/admin/operations");
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect("/admin/login");
    if (e instanceof HttpError && e.status === 403)
      return (
        <main id="main" data-admin style={{ padding: 50 }}>
          Administrator access is required.
        </main>
      );
    throw e;
  }
  return (
    <main id="main">
      <AdminApp operations />
    </main>
  );
}
