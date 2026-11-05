import type { Metadata } from "next";
import { getCategories } from "@/lib/catalog";
import { StoreChrome } from "@/components/StoreChrome";
import { operationsEnabled } from "@/server/operations/enabled";
import { Footer } from "@/components/Footer";
import { StoreProvider } from "@/components/StoreProvider";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "FORME — Everyday. Your way.", template: "%s | FORME" },
  description:
    "A contemporary men’s jewellery concept store. Discover rings, chains, earrings and everyday details. Prices in AUD.",
  icons: { icon: "/icon.svg" },
};
export const dynamic = "force-dynamic";
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const categories = await getCategories();
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <div id="top" aria-hidden="true" />
        <StoreProvider>
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          <StoreChrome
            categories={categories}
            footer={<Footer />}
            operations={operationsEnabled()}
          >
            {children}
          </StoreChrome>
        </StoreProvider>
      </body>
    </html>
  );
}
