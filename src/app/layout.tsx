import type { Metadata } from "next";
import { Suspense } from "react";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Panels } from "@/components/Panels";
import { StoreProvider } from "@/components/StoreProvider";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "FORME — Everyday. Your way.", template: "%s | FORME" },
  description:
    "A contemporary men’s jewellery concept store. Discover rings, chains, earrings and everyday details. Prices in AUD.",
  icons: { icon: "/icon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <div id="top" aria-hidden="true" />
        <StoreProvider>
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          <Header />
          {children}
          <Footer />
          <Suspense fallback={null}>
            <Panels />
          </Suspense>
        </StoreProvider>
      </body>
    </html>
  );
}
