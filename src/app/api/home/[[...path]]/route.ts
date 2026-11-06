import { requireStaff } from "@/server/operations/accounts";
import { checkOrigin } from "@/server/admin-auth";
import { errorResponse, HttpError, limitedBytes } from "@/server/errors";
import { homeData, homeMetadata, saveHomeLayout } from "@/server/home/service";
import { z } from "zod";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  try {
    const actor = await requireStaff(request.headers);
    const path = (await context.params).path?.join("/") || "";
    let data;
    if (request.method === "GET" && !path) data = await homeMetadata(actor);
    else {
      checkOrigin(request);
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        throw new HttpError(415, "Use application/json.");
      let body;
      try {
        body = JSON.parse(
          new TextDecoder().decode(await limitedBytes(request, 16 * 1024)),
        );
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, "Invalid JSON.");
      }
      if (request.method === "PUT" && !path)
        data = await saveHomeLayout(actor, body);
      else if (request.method === "POST" && path === "data")
        data = await homeData(
          actor,
          z.object({ widgets: z.unknown() }).strict().parse(body).widgets,
        );
      else throw new HttpError(404, "Not found.");
    }
    return Response.json(
      { data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const response = errorResponse(e);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
export const GET = handle;
export const PUT = handle;
export const POST = handle;
