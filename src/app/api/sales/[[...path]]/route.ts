import { requireStaff } from "@/server/operations/accounts";
import { checkOrigin } from "@/server/admin-auth";
import { readJson, errorResponse, HttpError } from "@/server/errors";
import { scheduleNotificationCheck } from "@/server/notifications/schedule";
import {
  orders,
  detail,
  metadata,
  saveFilter,
  caseDetail,
  compensationDetail,
  compensationWhere,
} from "@/server/sales/queries";
import { analytics } from "@/server/sales/analytics";
import { dashboard } from "@/server/sales/dashboard";
import { rules, saveRule, pauseTimer } from "@/server/sales/timeouts";
import {
  saveCase,
  caseAction,
  orderAction,
  saveCompensation,
  compensationAction,
  saveCampaign,
} from "@/server/sales/workflows";
import { database } from "@/server/db";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  try {
    const actor = await requireStaff(request.headers);
    const { path = [] } = await context.params;
    const [resource, id, action] = path;
    if (path.length > 3) throw new HttpError(404, "Not found");
    const query = Object.fromEntries(new URL(request.url).searchParams);
    let data: unknown;
    if (request.method === "GET") {
      if (resource === "meta") data = await metadata(actor);
      else if (resource === "home") data = await dashboard(actor, query.view);
      else if (resource === "orders")
        data = id ? await detail(actor, id) : await orders(actor, query);
      else if (resource === "analytics") data = await analytics(actor, query);
      else if (resource === "rules") data = await rules(actor);
      else if (resource === "cases" && id) data = await caseDetail(actor, id);
      else if (resource === "compensations" && id)
        data = await compensationDetail(actor, id);
      else if (resource === "cases" || resource === "compensations") {
        if (actor.role === "viewer")
          throw new HttpError(403, "Aftercare permission required");
        const page = Math.max(1, Number.parseInt(query.page || "1") || 1);
        const status = query.status || undefined;
        const db = database();
        if (resource === "cases") {
          const where = {
            ...(actor.role === "admin"
              ? {}
              : {
                  assigneeId: actor.id,
                  order: {
                    paymentStatus: "PAID" as const,
                    fulfillmentStatus: { not: "CANCELLED" as const },
                  },
                }),
            ...(status ? { status } : {}),
            ...(query.q ? { number: { contains: query.q.slice(0, 100) } } : {}),
          };
          data = {
            items: await db.aftercareCase.findMany({
              where,
              orderBy: [{ createdAt: "desc" }, { id: "asc" }],
              take: 25,
              skip: (page - 1) * 25,
            }),
            total: await db.aftercareCase.count({ where }),
            page,
          };
        } else {
          const where = compensationWhere(actor, query);
          data = {
            items: await db.compensation.findMany({
              where,
              orderBy: [{ createdAt: "desc" }, { id: "asc" }],
              take: 25,
              skip: (page - 1) * 25,
            }),
            total: await db.compensation.count({ where }),
            page,
          };
        }
      } else if (resource === "campaigns") {
        if (actor.role !== "admin") throw new HttpError(403, "Owner required");
        data = {
          items: await database().dealCampaign.findMany({
            orderBy: { startsAt: "desc" },
            take: 200,
          }),
        };
      } else throw new HttpError(404, "Not found");
      if (typeof data === "string")
        return new Response(data, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition":
              'attachment; filename="forme-' + resource + '.csv"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
    } else {
      checkOrigin(request);
      const body = await readJson(request);
      if (resource === "orders" && id && action === "action")
        data = await orderAction(actor, id, body);
      else if (resource === "cases")
        data =
          id && action === "action"
            ? await caseAction(actor, id, body)
            : !id
              ? await saveCase(actor, body)
              : undefined;
      else if (resource === "compensations")
        data =
          id && action === "action"
            ? await compensationAction(actor, id, body)
            : !id
              ? await saveCompensation(actor, body)
              : undefined;
      else if (resource === "filters") data = await saveFilter(actor, body);
      else if (resource === "rules") data = await saveRule(actor, body);
      else if (resource === "timers" && id && action === "pause")
        data = await pauseTimer(actor, id, body);
      else if (resource === "campaigns") data = await saveCampaign(actor, body);
      if (data === undefined) throw new HttpError(404, "Not found");
      scheduleNotificationCheck();
    }
    return Response.json(
      { data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const r = errorResponse(e);
    r.headers.set("Cache-Control", "no-store");
    return r;
  }
}
export const GET = handle;
export const POST = handle;
