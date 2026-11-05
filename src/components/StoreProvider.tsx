"use client";
import { createContext, useContext, useEffect, useState } from "react";
type BagItem = { id: string; quantity: number };
type Store = {
  bag: BagItem[];
  ready: boolean;
  add: (id: string, limit?: number) => void;
  change: (id: string, delta: number) => void;
  clear: () => void;
  panel: "search" | "bag" | "menu" | null;
  setPanel: (panel: Store["panel"]) => void;
};
const Context = createContext<Store | null>(null);
const STORAGE_KEY = "forme-demo-bag-v1";
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [bag, setBag] = useState<BagItem[]>([]);
  const [ready, setReady] = useState(false);
  const [panel, setPanel] = useState<Store["panel"]>(null);
  useEffect(() => {
    let cancelled = false;
    // Read browser-only storage after hydration; the server and first client render match.
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const saved: unknown = JSON.parse(
          localStorage.getItem(STORAGE_KEY) || "[]",
        );
        if (Array.isArray(saved))
          setBag(
            saved
              .filter(
                (v): v is BagItem =>
                  v &&
                  typeof v.id === "string" &&
                  Number.isInteger(v.quantity) &&
                  v.quantity > 0,
              )
              .map((v) => ({ ...v, quantity: Math.min(v.quantity, 99) })),
          );
      } catch {
        /* Unavailable or invalid browser storage: use an in-memory bag. */
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (ready) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(bag));
      } catch {
        /* Private mode remains usable. */
      }
    }
  }, [bag, ready]);
  const change = (id: string, delta: number) =>
    setBag((items) =>
      items
        .map((p) =>
          p.id === id
            ? { ...p, quantity: Math.min(99, p.quantity + delta) }
            : p,
        )
        .filter((p) => p.quantity > 0),
    );
  const add = (id: string, limit = 99) => {
    if(limit<1)return;
    setBag((items) =>
      items.some((p) => p.id === id)
        ? items.map((p) =>
            p.id === id ? { ...p, quantity: Math.min(99, limit, p.quantity + 1) } : p,
          )
        : [...items, { id, quantity: 1 }],
    );
    setPanel("bag");
  };
  return (
    <Context.Provider
      value={{
        bag,
        ready,
        add,
        change,
        clear: () => setBag([]),
        panel,
        setPanel,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useStore() {
  const store = useContext(Context);
  if (!store) throw new Error("StoreProvider is required");
  return store;
}
