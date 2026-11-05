import Link from "next/link";
import { operationsEnabled } from "@/server/operations/enabled";
import { Checkout } from "@/components/operations/Checkout";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Local checkout",
  robots: { index: false, follow: false },
};
export default function CheckoutPage() {
  return operationsEnabled() ? (
    <Checkout />
  ) : (
    <main id="main" style={{ padding: 40 }}>
      Local checkout is not enabled yet.{" "}
      <Link href="/shop">Return to shop</Link>
    </main>
  );
}
