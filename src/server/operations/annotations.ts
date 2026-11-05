import "server-only";
import { database } from "../db";
export async function withActorNames<T extends { actorId?: string | null }>(
  rows: T[],
) {
  const ids = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
  const names = ids.length
    ? await database().user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })
    : [];
  const special: Record<string, string> = {
    guest: "Guest checkout",
    "expiry-worker": "Reservation expiry task",
  };
  return rows.map((r) => ({
    ...r,
    actorName:
      names.find((u) => u.id === r.actorId)?.name ||
      special[r.actorId || ""] ||
      r.actorId ||
      "System",
  }));
}
