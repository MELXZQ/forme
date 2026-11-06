import "server-only";
import { AdminNavigation } from "./AdminNavigation";
import { adminGroups } from "@/lib/admin-navigation";
import type { Actor } from "@/server/operations/core";

export function AdminShell({
  actor,
  children,
}: {
  actor: Actor;
  children: React.ReactNode;
}) {
  // Only a boolean crosses the client boundary, never connection credentials.
  const databaseName = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).pathname
    : "";
  return (
    <>
      <AdminNavigation
        groups={adminGroups(actor.role, actor.capabilities)}
        role={actor.role}
        testWorkspace={databaseName.endsWith("_test")}
      />
      {children}
    </>
  );
}
