import { auth } from "@/server/auth";
import { checkOrigin } from "@/server/admin-auth";
import { errorResponse, limitedBytes } from "@/server/errors";
export const dynamic = "force-dynamic";
const allowed = new Set([
  "/api/auth/sign-in/email",
  "/api/auth/sign-out",
  "/api/auth/get-session",
]);
async function handle(request: Request) {
  try {
    const path = new URL(request.url).pathname;
    if (!allowed.has(path))
      return Response.json({ error: "Not found." }, { status: 404 });
    if (request.method === "POST") {
      checkOrigin(request);
      const bytes = await limitedBytes(request, 16 * 1024);
      request = new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: bytes,
      });
    }
    const response = await auth.handler(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
export const GET = handle;
export const POST = handle;
