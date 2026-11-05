import { cookies } from "next/headers";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { checkOrigin } from "@/server/admin-auth";
import { readJson, errorResponse, HttpError } from "@/server/errors";
import { requireOperations } from "@/server/operations/enabled";
import { guestLimit } from "@/server/operations/limits";
import {
  checkOrderAccess,
  orderDetails,
  cancelOrder,
  issueOrderAccess,
} from "@/server/operations/orders";
import { readableMedia } from "@/server/media";
import { authorizedOrderImage } from "@/server/operations/media";
import { key, reason } from "@/server/operations/validation";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  context: { params: Promise<{ id: string; path?: string[] }> },
) {
  try {
    requireOperations();
    const { id, path = [] } = await context.params;
    if (path.length > 2) throw new HttpError(404, "Not found.");
    const action = path[0];
    guestLimit("order-access", 100);
    const jar = await cookies();
    if (request.method === "POST") checkOrigin(request);
    if (request.method === "POST" && action === "access") {
      const { token } = z
        .object({ token: z.string().length(64) })
        .strict()
        .parse(await readJson(request));
      await checkOrderAccess(id, token);
      jar.set(`forme-order-${id}`, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 30 * 86400,
      });
      return Response.json(
        { data: { authorized: true } },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    await checkOrderAccess(id, jar.get(`forme-order-${id}`)?.value || "");
    let data: unknown;
    if (request.method === "POST" && action === "lookup-link") {
      const token = await issueOrderAccess(id);
      jar.set(`forme-order-${id}`, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 30 * 86400,
      });
      data = { token };
    } else if (request.method === "GET" && !action)
      data = await orderDetails({ id: "guest", role: "guest" }, id);
    else if (request.method === "POST" && action === "cancel") {
      const v = z
        .object({ key, reason })
        .strict()
        .parse(await readJson(request));
      data = await cancelOrder(
        { id: "guest", role: "guest" },
        id,
        v.key,
        v.reason,
      );
      revalidatePath("/", "layout");
    } else if (request.method === "GET" && action === "media" && path[1]) {
      await authorizedOrderImage(id, path[1]);
      const { media, bytes } = await readableMedia(path[1], true);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": media.mimeType,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    } else throw new HttpError(404, "Not found.");
    return Response.json(
      { data },
      {
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      },
    );
  } catch (e) {
    const r = errorResponse(e);
    r.headers.set("Cache-Control", "no-store");
    return r;
  }
}
export const GET = handle;
export const POST = handle;
