"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { money } from "@/lib/format";
import { Asset } from "../Asset";
import {
  obj,
  list,
  str,
  num,
  dateTime,
  MutationForm,
  reasonField,
  type Row,
} from "./ui";
import s from "./Operations.module.css";
const paymentLabel: Record<string, string> = {
  PENDING: "Awaiting payment",
  PAID: "Development payment recorded",
  FAILED: "Payment simulation failed",
  EXPIRED: "Stock reservation expired",
  REVIEW: "Manual payment review required",
};
const fulfillmentLabel: Record<string, string> = {
  UNFULFILLED: "Not shipped",
  SHIPPED: "Whole order shipped",
  CANCELLED: "Cancelled",
};
const actionLabel: Record<string, string> = {
  ORDER_CREATED: "Local order created",
  DEV_PAYMENT_EVENT: "Development payment status updated",
  ORDER_EXPIRED: "Stock reservation expired",
  ORDER_CANCELLED: "Order cancelled",
  ORDER_SHIPPED: "Whole order shipped",
  PHYSICAL_RETURN: "Returned goods inspected",
  LATE_PAYMENT_REVIEW: "Payment requires manual review",
};
async function request(id: string, action = "", body?: unknown) {
  const r = await fetch(
    `/api/orders/${encodeURIComponent(id)}${action ? `/${action}` : ""}`,
    {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    },
  );
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Order lookup failed.");
  return obj(data.data);
}
export function OrderStatus({ id }: { id: string }) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [privateLink, setPrivateLink] = useState(""),
    [loading, setLoading] = useState(true),
    [cancel, setCancel] = useState(false);
  const load = useCallback(async () => {
    try {
      const next = await request(id);
      setData(next);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const fragment = new URLSearchParams(location.hash.slice(1)),
          token = fragment.get("access");
        if (token) {
          await request(id, "access", { token });
          if (stopped) return;
          setPrivateLink(
            `${location.origin}/orders/${encodeURIComponent(id)}#access=${token}`,
          );
          history.replaceState(null, "", location.pathname);
        }
        if (!stopped) await load();
      } catch (e) {
        if (!stopped) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [id, load]);
  useEffect(() => {
    if (data?.paymentStatus !== "PENDING") return;
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [data?.paymentStatus, load]);
  return (
    <main id="main" className={s.checkout}>
      <Link href="/shop">← Shop</Link>
      <h1>{data ? `Order ${data.number}` : "Private order lookup"}</h1>
      <p className={s.notice}>
        Local development order. No real payment is connected and no real charge
        or refund has been processed.
      </p>
      {loading && <p role="status">Loading your private order…</p>}
      {error && (
        <p role="alert" className={s.error}>
          {error} Use the private lookup link saved after checkout. Order
          numbers alone do not grant access.
        </p>
      )}
      {data && (
        <>
          <p>
            <strong>
              {paymentLabel[str(data.paymentStatus)] || str(data.paymentStatus)}{" "}
              /{" "}
              {fulfillmentLabel[str(data.fulfillmentStatus)] ||
                str(data.fulfillmentStatus)}
            </strong>
          </p>
          {data.paymentStatus === "PENDING" &&
            data.fulfillmentStatus === "UNFULFILLED" && (
              <p>
                Melbourne stock reserved until {dateTime(data.expiresAt)}{" "}
                (Melbourne time).
              </p>
            )}
          {!!data.exception && <p className={s.error}>{str(data.exception)}</p>}
          {privateLink && (
            <p>
              <a href={privateLink} className={s.privateLink} rel="noreferrer">
                Save this private lookup link
              </a>
              <small>
                Keep it private: anyone with this link can view this order. It
                expires after 30 days.
              </small>
            </p>
          )}
          {!privateLink && (
            <button
              className={s.secondary}
              onClick={async () => {
                try {
                  const value = await request(id, "lookup-link", {});
                  setPrivateLink(
                    `${location.origin}/orders/${encodeURIComponent(id)}#access=${value.token}`,
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Create private lookup link to save
            </button>
          )}
          <div className={s.split}>
            <section className={s.box}>
              <h2>Purchased items</h2>
              {list(data.lines).map((l) => (
                <div className={s.receipt} key={str(l.id)}>
                  {!!l.imageMediaId && (
                    <Asset
                      src={`/api/orders/${id}/media/${l.imageMediaId}`}
                      alt={str(l.productName)}
                      width={90}
                      height={90}
                    />
                  )}
                  <strong>{str(l.productName)}</strong>
                  <p>
                    {str(l.sku)} · {str(l.size)} / {str(l.color)} ·{" "}
                    {num(l.quantity)} × {money(num(l.unitPriceCents))} AUD
                  </p>
                </div>
              ))}
              <dl>
                <dt>Items</dt>
                <dd>{money(num(data.subtotalCents))} AUD</dd>
                <dt>Fixed shipping</dt>
                <dd>{money(num(data.shippingCents))} AUD</dd>
                <dt>Total</dt>
                <dd>
                  <strong>{money(num(data.totalCents))} AUD</strong>
                </dd>
              </dl>
            </section>
            <section className={s.box}>
              <h2>Delivery details</h2>
              <p>
                {str(data.recipientName)}
                <br />
                {str(data.addressLine1)}
                <br />
                {str(data.addressLine2)}
                <br />
                {str(data.city)} {str(data.state)} {str(data.postcode)}
                <br />
                Australia
              </p>
              <p>{str(data.email)}</p>
              {!!data.trackingNumber && (
                <p>
                  {str(data.carrier)} · {str(data.trackingNumber)}
                </p>
              )}
            </section>
          </div>
          <h2>Timeline</h2>
          <ul>
            {list(data.history).map((h) => (
              <li key={str(h.id)}>
                {actionLabel[str(h.action)] || "Order updated"} ·{" "}
                {dateTime(h.createdAt)}
              </li>
            ))}
          </ul>
          {data.paymentStatus === "PENDING" &&
            data.fulfillmentStatus === "UNFULFILLED" && (
              <button
                className={s.secondary}
                onClick={() => setCancel((v) => !v)}
              >
                Cancel pending order
              </button>
            )}
          {cancel && (
            <MutationForm
              title="Cancel pending local order"
              fields={[reasonField]}
              initial={{ reason: "" }}
              submit={(v) => request(id, "cancel", v)}
              onSaved={() => void load()}
              onClose={() => setCancel(false)}
            />
          )}
          <button className={s.secondary} onClick={() => void load()}>
            Refresh order status
          </button>
        </>
      )}
    </main>
  );
}
export function OrderLookup() {
  const [value, setValue] = useState(""),
    [error, setError] = useState("");
  const router = useRouter();
  return (
    <main id="main" className={s.checkout}>
      <h1>Order lookup.</h1>
      <p>
        Paste the private lookup link saved after local checkout. An order
        number or email address alone cannot unlock an order.
      </p>
      <form
        className={s.box}
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const url = new URL(value, location.origin);
            if (
              url.origin !== location.origin ||
              !/^\/orders\/[a-zA-Z0-9_-]+$/.test(url.pathname) ||
              !new URLSearchParams(url.hash.slice(1)).get("access")
            )
              throw new Error("Paste a private order link from this site.");
            router.push(url.pathname + url.hash);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label className={s.field}>
          Private lookup link
          <input
            type="url"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button className={s.button}>Open private order</button>
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
      </form>
      <Link href="/shop">Continue browsing</Link>
    </main>
  );
}
