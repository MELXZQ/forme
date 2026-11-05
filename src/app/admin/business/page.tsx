import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/server/operations/accounts";
import { HttpError } from "@/server/errors";
import { BusinessApp } from "@/components/business/BusinessApp";
export const dynamic = "force-dynamic";
export default async function Page() {
  try {
    await requireStaff(await headers());
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect("/admin/login");
    if (e instanceof HttpError && e.status === 403)
      return <main id="main">Staff access required.</main>;
    throw e;
  }
  return <BusinessApp />;
}
