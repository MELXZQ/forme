import { AdminShell } from "@/components/admin/AdminShell";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { HttpError } from "@/server/errors";
import { AdminApp, type CatalogueSection } from "@/components/admin/AdminApp";
import { requireStaff } from "@/server/operations/accounts";
export const dynamic = "force-dynamic";
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ catalogue?: string; section?: string }>;
}) {
  const query = await searchParams;
  let actor;
  try {
    actor = await requireStaff(await headers());
    if (query.catalogue !== "1")
      redirect(
        actor.role === "viewer"
          ? "/admin/notifications"
          : "/admin/sales?section=home",
      );
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
  const section = (
    ["products", "categories", "collections", "media", "home"].includes(
      query.section || "",
    )
      ? query.section
      : "products"
  ) as CatalogueSection;
  return (
    <AdminShell actor={actor}>
      <main id="main">
        <AdminApp key={section} section={section} />
      </main>
    </AdminShell>
  );
}
