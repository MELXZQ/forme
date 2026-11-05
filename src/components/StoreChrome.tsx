"use client";
import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Suspense } from "react";
import type { Category } from "@/lib/types";
import { Header } from "./Header";
import { Panels } from "./Panels";
export function StoreChrome({
  children,
  footer,
  categories,
  operations = false,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
  categories: Category[];
  operations?: boolean;
}) {
  const admin = usePathname().startsWith("/admin");
  const router = useRouter();
  useEffect(() => {
    if (admin || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("forme-catalog");
    channel.onmessage = () => router.refresh();
    return () => channel.close();
  }, [admin, router]);
  return (
    <>
      {!admin && <Header categories={categories} />}
      {children}
      {!admin && footer}
      {!admin && (
        <Suspense fallback={null}>
          <Panels categories={categories} operations={operations} />
        </Suspense>
      )}
    </>
  );
}
