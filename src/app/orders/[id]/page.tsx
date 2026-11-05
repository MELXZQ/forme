import { OrderStatus } from "@/components/operations/OrderStatus";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Private local order",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <OrderStatus id={(await params).id} />;
}
