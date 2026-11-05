import { cookies } from "next/headers";
import { checkOrigin } from "@/server/admin-auth";
import { readJson, errorResponse, HttpError } from "@/server/errors";
import { requireOperations } from "@/server/operations/enabled";
import { guestLimit } from "@/server/operations/limits";
import {
  quote,
  createOrder,
  issueOrderAccess,
} from "@/server/operations/orders";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  try {
    requireOperations();
    checkOrigin(request);
    const { action } = await context.params;
    guestLimit(`checkout:${action}`);
    const input = await readJson(request);
    let data: unknown;
    if (action === "quote") data = await quote(input);
    else if (action === "create") {
      const order = await createOrder(input),
        accessToken = await issueOrderAccess(order.id);
      (await cookies()).set(`forme-order-${order.id}`, accessToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 30 * 86400,
      });
      data = order;
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
