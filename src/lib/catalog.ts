// Server-only data boundary. Browser components use DTO props or public API routes.
export {
  getProducts,
  listProducts,
  getProduct,
  getNewArrivals,
  getDeals,
  getCategories,
  getCollections,
  getHome,
} from "@/server/catalog";
export { money, discount } from "./format";
