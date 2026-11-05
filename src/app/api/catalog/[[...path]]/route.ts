import {
  listProducts,
  getProduct,
  getCategories,
  getCollections,
  getHome,
  getBagItems,
  getNewArrivals,
  getDeals,
} from "@/server/catalog";
import { errorResponse, HttpError } from "@/server/errors";
import type { ShopQuery } from "@/lib/types";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
) {
  try {
    const paths = (await context.params).path || [];
    const url = new URL(request.url);
    let data: unknown;
    if (paths[0] === "products" && paths.length === 2) {
      data = await getProduct(paths[1]);
      if (!data) throw new HttpError(404, "Product not found.");
    } else if (paths[0] === "products" && paths.length === 1) {
      const query: ShopQuery = {};
      for (const name of [
        "q",
        "category",
        "collection",
        "sale",
        "sort",
        "page",
        "pageSize",
      ] as const) {
        const value = url.searchParams.get(name);
        if (value) query[name] = value;
      }
      data = await listProducts(query);
    } else if (paths.join("/") === "categories") data = await getCategories();
    else if (paths.join("/") === "collections") data = await getCollections();
    else if (paths.join("/") === "home")
      data = {
        ...(await getHome()),
        newArrivals: await getNewArrivals(),
        deals: await getDeals(),
        collections: await getCollections(true),
      };
    else if (paths.join("/") === "bag") {
      const ids = (url.searchParams.get("ids") || "")
        .split(",")
        .filter(Boolean);
      if (ids.length > 100) throw new HttpError(400, "Too many items.");
      data = await getBagItems([...new Set(ids)]);
    } else throw new HttpError(404, "Not found.");
    return Response.json(
      { data },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
