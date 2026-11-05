import "server-only";
import { auth } from "./auth";
import { HttpError } from "./errors";
import { trustedOrigins } from "./origins";
export function checkOrigin(request: Request) {
  const allowed = new Set(trustedOrigins());
  if (
    !allowed.has(request.headers.get("origin") || "") ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new HttpError(403, "The request origin is not allowed.");
}
export async function requireAdmin(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session) throw new HttpError(401, "Please sign in.");
  if (session.user.role !== "admin" || !session.user.active)
    throw new HttpError(403, "Administrator access is required.");
  return session;
}
