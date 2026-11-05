import { scheduleNotificationCheck } from "@/server/notifications/schedule";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  requireStaff,
  listAccounts,
  createAccount,
  updateAccount,
} from "@/server/operations/accounts";
import { requireOperations } from "@/server/operations/enabled";
import { checkOrigin } from "@/server/admin-auth";
import {
  readJson,
  limitedBytes,
  errorResponse,
  HttpError,
} from "@/server/errors";
import {
  applyStockAction,
  submitCount,
  decideCount,
  skuDetails,
  resolveLegacyDiscrepancy,
} from "@/server/operations/inventory";
import {
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  updateTransfer,
  cancelTransfer,
  returnTransfer,
  transferDetails,
} from "@/server/operations/transfers";
import {
  inventoryList,
  orderList,
  transferList,
  countList,
  operationsLookup,
  auditHistory,
} from "@/server/operations/queries";
import {
  orderDetails,
  cancelOrder,
  shipOrder,
  registerReturn,
  simulatePayment,
} from "@/server/operations/orders";
import {
  commerceSettings,
  saveCommerceSettings,
  saveSkuPolicy,
} from "@/server/operations/settings";
import { key, reason } from "@/server/operations/validation";
import { owner, csv, staff } from "@/server/operations/core";
import { uploadImages, readableMedia } from "@/server/media";
import { authorizedStaffMedia } from "@/server/operations/media";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(
  request: Request,
  context: { params: Promise<{ resource: string; path?: string[] }> },
) {
  try {
    const actor = await requireStaff(request.headers);
    requireOperations();
    if (request.method !== "GET") checkOrigin(request);
    const { resource, path = [] } = await context.params;
    const [id, action] = path;
    if (path.length > 2) throw new HttpError(404, "Not found.");
    const q = Object.fromEntries(new URL(request.url).searchParams);
    let data: unknown;
    if (request.method === "GET") {
      if (resource === "inventory") {
        if (id) data = await skuDetails(actor, id);
        else {
          const result = await inventoryList(actor, q, q.format === "csv");
          if (q.format === "csv") {
            staff(actor, true);
            return new Response(
              csv([
                [
                  "SKU",
                  "Product",
                  "Size",
                  "Color",
                  ...(actor.role === "warehouse"
                    ? []
                    : ["Beijing physical", "Beijing available"]),
                  "In transit",
                  "Melbourne physical",
                  "Melbourne reserved",
                  "Melbourne unavailable",
                  "Melbourne available",
                  "ETA start",
                  "ETA end",
                ],
                ...result.items.map((v) => [
                  v.sku,
                  v.name,
                  v.size,
                  v.color,
                  ...(actor.role === "warehouse"
                    ? []
                    : [v.beijing?.onHand, v.beijing?.available]),
                  v.inTransit,
                  v.melbourne.onHand,
                  v.melbourne.reserved,
                  v.melbourne.unavailable,
                  v.melbourne.available,
                  v.etaStart,
                  v.etaEnd,
                ]),
              ]),
              {
                headers: {
                  "Content-Type": "text/csv; charset=utf-8",
                  "Content-Disposition": "attachment; filename=inventory.csv",
                  "Cache-Control": "no-store",
                },
              },
            );
          }
          data = result;
        }
      } else if (resource === "transfers")
        data = id
          ? await transferDetails(actor, id)
          : await transferList(actor, q);
      else if (resource === "orders") {
        if (id) data = await orderDetails(actor, id);
        else {
          const result = await orderList(actor, q, q.format === "csv");
          if (q.format === "csv") {
            owner(actor);
            return new Response(
              csv([
                [
                  "Order",
                  "Email",
                  "Recipient",
                  "Payment",
                  "Fulfillment",
                  "Whole order cents",
                  "Matching item cents",
                  "Order discount cents",
                  "Currency",
                  "Carrier",
                  "Tracking",
                ],
                ...result.items.map((o) => [
                  o.number,
                  o.email,
                  o.recipientName,
                  o.paymentStatus,
                  o.fulfillmentStatus,
                  o.totalCents,
                  o.matchedItemCents,
                  o.discountCents,
                  o.currency,
                  o.carrier,
                  o.trackingNumber,
                ]),
              ]),
              {
                headers: {
                  "Content-Type": "text/csv; charset=utf-8",
                  "Content-Disposition": "attachment; filename=orders.csv",
                  "Cache-Control": "no-store",
                },
              },
            );
          }
          data = result;
        }
      } else if (resource === "accounts" && !id)
        data = await listAccounts(actor);
      else if (resource === "history" && !id)
        data = await auditHistory(actor, q);
      else if (resource === "counts" && !id) data = await countList(actor);
      else if (resource === "lookup" && !id)
        data = await operationsLookup(actor);
      else if (resource === "settings" && !id) {
        owner(actor);
        data = {
          ...(await commerceSettings()),
          devPayments:
            process.env.NODE_ENV !== "production" &&
            process.env.ENABLE_DEV_PAYMENTS === "true",
        };
      } else if (resource === "profile" && !id) data = actor;
      else if (resource === "media" && id) {
        await authorizedStaffMedia(actor, id);
        const { media, bytes } = await readableMedia(id, true);
        return new Response(new Uint8Array(bytes), {
          headers: {
            "Content-Type": media.mimeType,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
          },
        });
      } else throw new HttpError(404, "Not found.");
    } else if (request.method === "POST") {
      if (resource === "media" && !id) {
        staff(actor, true);
        let form: FormData;
        try {
          form = await new Response(
            await limitedBytes(request, 24 * 1024 * 1024),
            {
              headers: {
                "Content-Type": request.headers.get("content-type") || "",
              },
            },
          ).formData();
        } catch (e) {
          if (e instanceof HttpError) throw e;
          throw new HttpError(400, "Invalid multipart image upload.");
        }
        const files = form.getAll("files");
        if (files.some((f) => !(f instanceof File)))
          throw new HttpError(400, "Choose image files.");
        data = await uploadImages(files as File[]);
      } else {
        const body = await readJson(request);
        const base = () => z.object({ key, reason }).strict().parse(body);
        if (resource === "inventory" && id === "movement")
          data = await applyStockAction(actor, body);
        else if (resource === "inventory" && id === "resolve-legacy")
          data = await resolveLegacyDiscrepancy(actor, body);
        else if (resource === "inventory" && id === "count")
          data = await submitCount(actor, body);
        else if (resource === "inventory" && id === "policy")
          data = await saveSkuPolicy(actor, body);
        else if (resource === "counts" && id && action === "decision") {
          const v = z
            .object({ key, reason, approved: z.boolean() })
            .strict()
            .parse(body);
          data = await decideCount(actor, id, v.key, v.approved, v.reason);
        } else if (resource === "transfers" && !id)
          data = await createTransfer(actor, body);
        else if (resource === "transfers" && id) {
          if (action === "dispatch")
            data = await dispatchTransfer(actor, id, body);
          else if (action === "receive")
            data = await receiveTransfer(actor, id, body);
          else if (action === "update")
            data = await updateTransfer(actor, id, body);
          else if (action === "return")
            data = await returnTransfer(actor, id, body);
          else if (action === "cancel") {
            const v = base();
            data = await cancelTransfer(actor, id, v.key, v.reason);
          } else throw new HttpError(404, "Not found.");
        } else if (resource === "orders" && id) {
          if (action === "ship") data = await shipOrder(actor, id, body);
          else if (action === "return")
            data = await registerReturn(actor, id, body);
          else if (action === "simulate-payment")
            data = await simulatePayment(actor, id, body);
          else if (action === "cancel") {
            const v = base();
            data = await cancelOrder(actor, id, v.key, v.reason);
          } else throw new HttpError(404, "Not found.");
        } else if (resource === "accounts") {
          data = id
            ? await updateAccount(actor, {
                ...z.record(z.string(), z.unknown()).parse(body),
                id,
              })
            : await createAccount(actor, body);
        } else if (resource === "settings" && !id)
          data = await saveCommerceSettings(actor, body);
        else throw new HttpError(404, "Not found.");
      }
      revalidatePath("/", "layout");
    } else throw new HttpError(405, "Method not allowed.");
    if (request.method !== "GET") scheduleNotificationCheck();
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
