import { scheduleNotificationCheck } from "@/server/notifications/schedule";
import { revalidatePath } from "next/cache";
import { requireAdmin, checkOrigin } from "@/server/admin-auth";
import {
  errorResponse,
  HttpError,
  readJson,
  limitedBytes,
} from "@/server/errors";
import {
  listAdminProducts,
  adminProduct,
  saveProduct,
  saveTaxonomy,
  listAdminTaxonomies,
  getAdminHome,
  saveHome,
} from "@/server/admin-services";
import {
  deleteMedia,
  uploadImages,
  listAdminMedia,
  updateMedia,
} from "@/server/media";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
async function handle(
  request: Request,
  context: { params: Promise<{ resource: string; id?: string[] }> },
) {
  try {
    const admin = await requireAdmin(request.headers);
    if (request.method !== "GET") checkOrigin(request);
    const { resource, id: path } = await context.params;
    const id = path?.[0];
    if ((path?.length || 0) > 1) throw new HttpError(404, "Not found.");
    const url = new URL(request.url);
    let data: unknown;
    if (request.method === "GET") {
      if (resource === "products")
        data = id
          ? await adminProduct(id)
          : await listAdminProducts(
              url.searchParams.get("q") || "",
              url.searchParams.get("status") || "",
            );
      else if (resource === "categories" || resource === "collections")
        data = await listAdminTaxonomies(resource);
      else if (resource === "media") data = await listAdminMedia();
      else if (resource === "home") data = await getAdminHome();
      else throw new HttpError(404, "Not found.");
    } else if (request.method === "POST" && resource === "media" && !id) {
      const bytes = await limitedBytes(request, 24 * 1024 * 1024);
      const form = await new Response(bytes, {
        headers: { "Content-Type": request.headers.get("content-type") || "" },
      }).formData();
      const files = form.getAll("files");
      if (files.some((f) => !(f instanceof File)))
        throw new HttpError(400, "Choose image files.");
      data = await uploadImages(files as File[]);
    } else if (["POST", "PUT"].includes(request.method)) {
      if (request.method === "PUT" && !id && resource !== "home")
        throw new HttpError(400, "An item ID is required.");
      if (request.method === "POST" && id)
        throw new HttpError(400, "Use PUT to edit an item.");
      const body = await readJson(request);
      if (resource === "products")
        data = await saveProduct(body, id, {
          id: admin.user.id,
          role: "admin",
        });
      else if (resource === "categories" || resource === "collections")
        data = await saveTaxonomy(resource, body, id);
      else if (resource === "home") data = await saveHome(body);
      else if (resource === "media" && id) data = await updateMedia(id, body);
      else throw new HttpError(404, "Not found.");
    } else if (request.method === "DELETE" && resource === "media" && id) {
      await deleteMedia(id);
      data = { deleted: true };
    } else
      throw new HttpError(
        405,
        "This operation is not supported. Disable or archive the item instead.",
      );
    if (request.method !== "GET") revalidatePath("/", "layout");
    if (request.method !== "GET") scheduleNotificationCheck();
    return Response.json(
      { data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
