import { requireStaff } from "@/server/operations/accounts";
import { checkOrigin } from "@/server/admin-auth";
import {
  readJson,
  limitedBytes,
  errorResponse,
  HttpError,
} from "@/server/errors";
import { scheduleNotificationCheck } from "@/server/notifications/schedule";
import {
  metadata,
  suppliers,
  purchases,
  expenses,
  recurringList,
  logistics,
  businessDetail,
  attachments,
  grants,
  saveGrant,
} from "@/server/business/queries";
import {
  saveSupplier,
  saveSource,
  savePurchase,
  confirmPurchase,
  receivePurchase,
  receiptContext,
  returnSupplier,
  closePurchaseLine,
  finishPurchase,
} from "@/server/business/purchases";
import {
  saveExpense,
  recordCash,
  expenseAction,
  linkExpense,
  saveExpenseCategory,
} from "@/server/business/expenses";
import { saveRecurring, backfillRecurring } from "@/server/business/recurring";
import { createParcel, parcelEvent } from "@/server/business/logistics";
import {
  uploadAttachments,
  downloadAttachment,
  attachmentPermission,
} from "@/server/business/attachments";
export const dynamic = "force-dynamic";
async function handle(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  try {
    const actor = await requireStaff(request.headers);
    const { path = [] } = await context.params;
    if (path.length > 3) throw new HttpError(404, "Not found");
    const [resource, id, action] = path;
    const query = Object.fromEntries(new URL(request.url).searchParams);
    let data: unknown;
    if (request.method === "GET") {
      if (resource === "meta") data = await metadata(actor);
      else if (resource === "attachment" && id)
        return await downloadAttachment(actor, id);
      else if (resource === "attachments")
        data = await attachments(actor, query.objectType, query.objectId);
      else if (resource === "grants") data = await grants(actor);
      else if (resource === "purchases" && id && action === "receiving")
        data = await receiptContext(actor, id);
      else if (id) data = await businessDetail(actor, resource, id);
      else if (resource === "suppliers") data = await suppliers(actor, query);
      else if (resource === "purchases") data = await purchases(actor, query);
      else if (resource === "expenses") data = await expenses(actor, query);
      else if (resource === "recurring") data = await recurringList(actor);
      else if (resource === "logistics") data = await logistics(actor, query);
      else throw new HttpError(404, "Not found");
      if (typeof data === "string" && query.format === "csv")
        return new Response(data, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="forme-${resource}.csv"`,
            "Cache-Control": "no-store",
          },
        });
    } else {
      checkOrigin(request);
      if (resource === "attachments") {
        await attachmentPermission(actor, query.objectType, query.objectId);
        const bytes = await limitedBytes(request, 40 * 1024 * 1024);
        const form = await new Response(bytes, {
          headers: {
            "Content-Type": request.headers.get("content-type") || "",
          },
        }).formData();
        const files = form
          .getAll("files")
          .filter((f): f is File => f instanceof File);
        data = await uploadAttachments(
          actor,
          query.objectType,
          query.objectId,
          files,
        );
      } else {
        const body = await readJson(request);
        if (resource === "suppliers") data = await saveSupplier(actor, body);
        else if (resource === "sources") data = await saveSource(actor, body);
        else if (resource === "purchases" && !id)
          data = await savePurchase(actor, body);
        else if (resource === "purchases" && id && action === "confirm")
          data = await confirmPurchase(actor, id, body);
        else if (resource === "purchases" && id && action === "receive")
          data = await receivePurchase(actor, id, body);
        else if (resource === "purchases" && id && action === "return")
          data = await returnSupplier(actor, id, body);
        else if (resource === "purchases" && id && action === "close-line")
          data = await closePurchaseLine(actor, id, body);
        else if (resource === "purchases" && id && action === "finish")
          data = await finishPurchase(actor, id, body);
        else if (resource === "expenses" && !id)
          data = await saveExpense(actor, body);
        else if (resource === "expenses" && id && action === "cash")
          data = await recordCash(actor, id, body);
        else if (resource === "expenses" && id && action === "action")
          data = await expenseAction(actor, id, body);
        else if (resource === "expenses" && id && action === "link")
          data = await linkExpense(actor, id, body);
        else if (resource === "categories")
          data = await saveExpenseCategory(actor, body);
        else if (resource === "recurring" && !id)
          data = await saveRecurring(actor, body);
        else if (resource === "recurring" && id && action === "backfill")
          data = await backfillRecurring(actor, id, body);
        else if (resource === "logistics" && !id)
          data = await createParcel(actor, body);
        else if (resource === "logistics" && id && action === "event")
          data = await parcelEvent(actor, id, body);
        else if (resource === "grants") data = await saveGrant(actor, body);
        else throw new HttpError(404, "Not found");
      }
      scheduleNotificationCheck();
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
export const POST = handle;
