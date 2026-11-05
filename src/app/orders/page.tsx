import { OrderLookup } from "@/components/operations/OrderStatus";
export const metadata = {
  title: "Private order lookup",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function Orders() {
  return <OrderLookup />;
}
