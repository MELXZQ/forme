import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { Login } from "@/components/admin/Login";
export const dynamic = "force-dynamic";
export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user.role === "admin" && session.user.active) redirect("/admin");
  if (
    session?.user.active &&
    ["warehouse", "viewer"].includes(session.user.role)
  )
    redirect("/admin/operations");
  return (
    <main id="main">
      <Login />
    </main>
  );
}
