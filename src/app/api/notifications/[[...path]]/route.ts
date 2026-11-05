import { scheduleNotificationCheck } from "@/server/notifications/schedule";
import { requireStaff } from "@/server/operations/accounts";
import { checkOrigin } from "@/server/admin-auth";
import { readJson, errorResponse, HttpError } from "@/server/errors";
import {
  listNotifications,
  notificationDetail,
  actNotification,
  savePreference,
} from "@/server/notifications/service";
import {
  settings,
  saveRules,
  stockPreview,
  saveStockPolicies,
  stockPolicies,
  productPolicies,
  saveProductPolicies,
} from "@/server/notifications/rules";
import { runNotificationCheck } from "@/server/notifications/engine";
import { z } from "zod";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  try {
    const actor = await requireStaff(request.headers);
    const { path = [] } = await context.params;
    const [resource, id] = path;
    if (path.length > 2) throw new HttpError(404, "Not found.");
    let data: unknown;
    if (request.method === "GET") {
      if (!resource)
        data = await listNotifications(
          actor,
          Object.fromEntries(new URL(request.url).searchParams),
        );
      else if (resource === "item" && id)
        data = await notificationDetail(actor, id);
      else if (resource === "rules") data = await settings(actor);
      else if (resource === "stock") data = await stockPolicies(actor);
      else if (resource === "products") data = await productPolicies(actor);
      else throw new HttpError(404, "Not found.");
    } else {
      checkOrigin(request);
      const body = await readJson(request);
      if (resource === "item" && id)
        data = await actNotification(actor, id, body);
      else if (resource === "preference")
        data = await savePreference(actor, body);
      else if (resource === "rules") data = await saveRules(actor, body);
      else if (resource === "preview")
        data = await stockPreview(
          actor,
          z
            .object({
              warehouse: z.enum(["BEIJING", "MELBOURNE"]),
              ids: z.array(z.string().max(120)).max(5000).optional(),
              filters: z.record(z.string(), z.string().max(200)).optional(),
            })
            .strict()
            .parse(body),
        );
      else if (resource === "stock")
        data = await saveStockPolicies(actor, body);
      else if (resource === "products")
        data = await saveProductPolicies(actor, body);
      else if (resource === "check")
        data = await runNotificationCheck(actor, true);
      else throw new HttpError(404, "Not found.");
    }
    if (request.method !== "GET") scheduleNotificationCheck();
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
export const POST = handle;
