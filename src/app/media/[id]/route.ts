import { auth } from "@/server/auth";
import { readableMedia } from "@/server/media";
import { errorResponse } from "@/server/errors";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    const { media, bytes } = await readableMedia(
      (await context.params).id,
      !!session && session.user.role === "admin" && session.user.active,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": media.mimeType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
