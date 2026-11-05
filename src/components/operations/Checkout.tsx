"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "../StoreProvider";
import { money } from "@/lib/format";
import { Inputs, obj, list, num, str, type Row, type Field } from "./ui";
import s from "./Operations.module.css";
const fields: Field[] = [
  { name: "email", label: "Contact email", required: true },
  { name: "recipientName", label: "Recipient name", required: true },
  { name: "addressLine1", label: "Street address", required: true },
  { name: "addressLine2", label: "Apartment / unit (optional)" },
  { name: "city", label: "City / suburb", required: true },
  {
    name: "state",
    label: "State / territory",
    type: "select",
    options: [
      { value: "", label: "Choose state" },
      ...["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"].map((v) => ({
        value: v,
        label: v,
      })),
    ],
    required: true,
  },
  { name: "postcode", label: "Postcode (4 digits)", required: true },
];
async function checkoutApi(action: string, body: unknown) {
  const r = await fetch(`/api/checkout/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = await r.json();
  if (!r.ok)
    throw new Error(
      [
        result.error,
        ...(result.details || []).map(
          (v: { path: string; message: string }) => `${v.path}: ${v.message}`,
        ),
      ].join("\n"),
    );
  return obj(result.data);
}
export function Checkout() {
  const { bag, ready, clear } = useStore(),
    router = useRouter(),
    bagKey = JSON.stringify(bag),
    [quote, setQuote] = useState<Row | null>(null),
    [items, setItems] = useState<{ variantId: string; quantity: number }[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [address, setAddress] = useState<Row>({
      email: "",
      recipientName: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      postcode: "",
    });
  const loadVersion = useRef(0);
  const invalidate = useCallback(() => {
    loadVersion.current++;
  }, []);
  const load = useCallback(async () => {
    if (!ready) return;
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");
    try {
      const saved: { id: string; quantity: number }[] = JSON.parse(bagKey);
      if (!saved.length) {
        setItems([]);
        setQuote(null);
        return;
      }
      const r = await fetch(
        `/api/catalog/bag?ids=${encodeURIComponent(saved.map((v) => v.id).join(","))}`,
        { cache: "no-store" },
      );
      if (!r.ok) throw new Error("Could not refresh the bag.");
      const products = list((await r.json()).data);
      if (products.length !== saved.length)
        throw new Error(
          "Some saved items are unavailable. Edit your bag before checkout.",
        );
      const grouped = new Map<string, number>();
      for (const line of saved) {
        const p = products.find((p) => p.id === line.id)!;
        grouped.set(
          str(p.variantId),
          (grouped.get(str(p.variantId)) ?? 0) + line.quantity,
        );
      }
      const next = [...grouped].map(([variantId, quantity]) => ({
        variantId,
        quantity,
      }));
      const q = await checkoutApi("quote", { items: next });
      if (version !== loadVersion.current) return;
      setItems(next);
      setQuote(q);
    } catch (e) {
      if (version === loadVersion.current) {
        setQuote(null);
        setError((e as Error).message);
      }
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [bagKey, ready]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
      invalidate();
    };
  }, [load, invalidate]);
  return (
    <main id="main" className={s.checkout}>
      <Link href="/shop">← Continue browsing</Link>
      <h1>Local checkout.</h1>
      <p className={s.notice}>
        Development checkout: no real payment is connected and no money will be
        charged. Australia only. Goods ship from Melbourne.
      </p>
      {loading && (
        <p role="status">Checking current prices and Melbourne stock…</p>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {!loading && !items.length && !quote && (
        <p>
          Your bag is empty or unavailable.{" "}
          <Link href="/shop">Browse jewellery</Link>
        </p>
      )}
      {quote && (
        <div className={s.split}>
          <form
            className={s.box}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const input = { items, ...address, country: "AU" };
                const digest = await crypto.subtle.digest(
                  "SHA-256",
                  new TextEncoder().encode(JSON.stringify(input)),
                );
                const fingerprint = Array.from(new Uint8Array(digest))
                  .map((v) => v.toString(16).padStart(2, "0"))
                  .join("");
                let entry: { fingerprint: string; key: string } | null = null;
                try {
                  entry = JSON.parse(
                    sessionStorage.getItem("forme-checkout-request") || "null",
                  );
                } catch {}
                const requestKey =
                  entry?.fingerprint === fingerprint
                    ? entry.key
                    : crypto.randomUUID();
                try {
                  sessionStorage.setItem(
                    "forme-checkout-request",
                    JSON.stringify({ fingerprint, key: requestKey }),
                  );
                } catch {}
                const order = await checkoutApi("create", {
                  ...input,
                  key: requestKey,
                });
                clear();
                router.push(`/orders/${order.id}`);
              } catch (e) {
                const message = (e as Error).message;
                await load();
                setError(message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>Delivery details</h2>
            <fieldset
              disabled={busy || loading}
              style={{ border: 0, padding: 0 }}
            >
              <Inputs fields={fields} value={address} onChange={setAddress} />
              <button
                className={s.button}
                disabled={!quote.canCheckout || busy}
              >
                {busy
                  ? "Creating local order…"
                  : "Create local order — no charge"}
              </button>
            </fieldset>
            <p className={s.muted}>
              Available stock is reserved for {num(quote.reservationMinutes)}{" "}
              minutes after submission. Orders awaiting payment expire
              automatically when the local reservation worker is running.
            </p>
          </form>
          <div className={s.box}>
            <h2>Order summary</h2>
            {list(quote.lines).map((l) => (
              <div key={str(l.variantId)} className={s.receipt}>
                <strong>{str(l.name)}</strong>
                <p>
                  {str(l.option)} · {num(l.quantity)} ×{" "}
                  {money(num(l.unitPriceCents))} AUD
                </p>
                <p>
                  {num(l.available)} available in Melbourne
                  {!l.sufficient ? " — reduce your bag quantity" : ""}
                </p>
              </div>
            ))}
            <dl>
              <dt>Items</dt>
              <dd>{money(num(quote.subtotalCents))} AUD</dd>
              <dt>Fixed Australian shipping</dt>
              <dd>
                {quote.shippingCents === null
                  ? "Not configured"
                  : `${money(num(quote.shippingCents))} AUD`}
              </dd>
              <dt>
                <strong>Total</strong>
              </dt>
              <dd>
                {quote.totalCents === null
                  ? "Unavailable"
                  : `${money(num(quote.totalCents))} AUD`}
              </dd>
            </dl>
            {quote.shippingCents === null && (
              <p role="alert">
                Shipping is not configured. Checkout is currently unavailable.
              </p>
            )}
            <button className={s.secondary} onClick={() => void load()}>
              Refresh price / stock
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
