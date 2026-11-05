export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const body = await response.json();
  if (response.status === 401) {
    window.location.assign(
      new URL("/admin/login", window.location.origin).href,
    );
    throw new Error("Please sign in.");
  }
  if (!response.ok)
    throw new Error(
      [
        body.error,
        ...(body.details || []).map(
          (d: { path: string; message: string }) => `${d.path}: ${d.message}`,
        ),
      ].join("\n"),
    );
  if (
    init?.method &&
    init.method !== "GET" &&
    typeof BroadcastChannel !== "undefined"
  ) {
    const channel = new BroadcastChannel("forme-catalog");
    channel.postMessage("updated");
    channel.close();
  }
  return body.data as T;
}
export type MediaItem = {
  id: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  mimeType: string;
  sizeBytes: number;
};
export type Taxonomy = {
  id: string;
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  active: boolean;
  mediaId?: string | null;
  featured?: boolean;
};
