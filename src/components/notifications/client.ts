import { announceAdminChange } from "@/lib/admin-refresh";
export async function api<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api/notifications/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await r.json();
  if (r.status === 401)
    window.location.assign(
      new URL("/admin/login", window.location.origin).href,
    );
  if (!r.ok)
    throw new Error(
      [
        data.error,
        ...(data.details || []).map(
          (v: { path: string; message: string }) => v.path + ": " + v.message,
        ),
      ].join("\n"),
    );
  if (body !== undefined) announceAdminChange();
  return data.data;
}
