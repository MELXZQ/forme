import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/server/operations/accounts";
import { HttpError } from "@/server/errors";
import { SalesApp } from "@/components/sales/SalesApp";
export const dynamic = "force-dynamic";
export default async function Page() {
  try {
    await requireStaff(await headers());
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect("/admin/login");
    throw e;
  }
  return <SalesApp />;
}
