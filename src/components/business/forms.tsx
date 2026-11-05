"use client";
import { useRef, useState } from "react";
import { type Row, obj, list, str } from "../operations/ui";
import s from "../operations/Operations.module.css";
export type Field = {
  name: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "amount"
    | "rate"
    | "number"
    | "date"
    | "datetime"
    | "select"
    | "checkbox";
  options?: { value: string; label: string }[];
  required?: boolean;
  help?: string;
};
export const choices = (values: string[]) =>
  values.map((value) => ({ value, label: value }));
export const pick = (rows: Row[], label = "name") =>
  rows.map((r) => ({ value: str(r.id), label: str(r[label]) }));
export const today = () => new Date().toLocaleDateString("en-CA");
export function decimal(value: unknown, digits = 2) {
  if (value == null || value === "") return "";
  return (Number(value) / 10 ** digits).toFixed(digits);
}
function integerAmount(value: string, digits = 2) {
  if (!new RegExp("^\\d+(?:\\.\\d{1," + digits + "})?$").test(value))
    throw new Error(
      "Use a non-negative amount with at most " + digits + " decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  const n = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0"));
  if (!Number.isSafeInteger(n)) throw new Error("Amount too large");
  return n;
}
function initialValues(fields: Field[], initial: Row) {
  return Object.fromEntries(
    fields.map((f) => {
      const v = initial[f.name];
      return [
        f.name,
        f.type === "amount" || f.type === "rate"
          ? decimal(v, f.type === "rate" ? 6 : 2)
          : f.type === "date"
            ? str(v).slice(0, 10)
            : f.type === "datetime"
              ? v
                ? new Date(str(v))
                    .toLocaleString("sv-SE")
                    .replace(" ", "T")
                    .slice(0, 16)
                : new Date()
                    .toLocaleString("sv-SE")
                    .replace(" ", "T")
                    .slice(0, 16)
              : f.type === "checkbox"
                ? !!v
                : (v ?? ""),
      ];
    }),
  );
}
export async function businessApi(path: string, body?: unknown) {
  const response = await fetch("/api/business/" + path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const v = await response.json();
  if (response.status === 401)
    window.location.assign(
      new URL("/admin/login", window.location.origin).href,
    );
  if (!response.ok)
    throw new Error(
      [
        v.error,
        ...(v.details || []).map(
          (d: { path: string; message: string }) => d.path + ": " + d.message,
        ),
      ].join("\n"),
    );
  return v.data as Row;
}
export function BusinessForm({
  title,
  fields,
  initial = {},
  endpoint,
  extra = {},
  meta,
  onSaved,
  lineKind,
  lineRows = [],
}: {
  title: string;
  fields: Field[];
  initial?: Row;
  endpoint: string;
  extra?: Row;
  meta: Row;
  onSaved: (result: Row) => void;
  lineKind?: "purchase" | "receipt" | "parcel";
  lineRows?: Row[];
}) {
  const [values, setValues] = useState<Row>(() =>
      initialValues(fields, initial),
    ),
    [rows, setRows] = useState<Row[]>(() =>
      lineRows.length
        ? lineRows.map((l) => ({
            ...l,
            unitCost: decimal(l.unitCost),
            lineId: l.lineId ?? l.id,
          }))
        : lineKind
          ? [
              {
                variantId: "",
                quantity: 1,
                unitCost: "0.00",
                supplierCode: "",
                sellable: 0,
                unavailable: 0,
              },
            ]
          : [],
    ),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  function field(f: Field) {
    const value = values[f.name];
    return (
      <label className={s.field} key={f.name}>
        {f.label}
        {f.type === "select" ? (
          <select
            value={str(value)}
            required={f.required}
            onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
          >
            <option value="">Choose / none</option>
            {f.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : f.type === "checkbox" ? (
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) =>
              setValues({ ...values, [f.name]: e.target.checked })
            }
          />
        ) : f.type === "textarea" ? (
          <textarea
            value={str(value)}
            required={f.required}
            onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
          />
        ) : (
          <input
            type={
              f.type === "datetime"
                ? "datetime-local"
                : ["amount", "rate"].includes(f.type || "")
                  ? "text"
                  : f.type || "text"
            }
            inputMode={
              f.type === "amount" || f.type === "rate" ? "decimal" : undefined
            }
            value={str(value)}
            required={f.required}
            min={f.type === "number" ? 0 : undefined}
            step={f.type === "number" ? 1 : undefined}
            onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
          />
        )}
        <small>{f.help}</small>
      </label>
    );
  }
  return (
    <form
      className={s.box}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          const data: Row = { ...extra, reason };
          for (const f of fields) {
            const v = values[f.name];
            data[f.name] =
              f.type === "amount"
                ? v === ""
                  ? null
                  : integerAmount(str(v))
                : f.type === "rate"
                  ? v === ""
                    ? null
                    : integerAmount(str(v), 6)
                  : f.type === "number"
                    ? Number(v)
                    : f.type === "date"
                      ? v || null
                      : f.type === "datetime"
                        ? new Date(str(v)).toISOString()
                        : f.type === "checkbox"
                          ? !!v
                          : v;
          }
          for (const name of [
            "supplierId",
            "purchaseId",
            "transferId",
            "orderId",
            "returnId",
            "correctionOf",
            "warehouse",
          ])
            if (data[name] === "") data[name] = null;
          if (data.resumeFrom === null) delete data.resumeFrom;
          if (lineKind)
            data.lines = rows
              .map((r) =>
                lineKind === "purchase"
                  ? {
                      variantId: r.variantId,
                      quantity: Number(r.quantity),
                      unitCost: integerAmount(str(r.unitCost)),
                      supplierCode: r.supplierCode || "",
                    }
                  : lineKind === "receipt"
                    ? {
                        lineId: r.lineId,
                        sellable: Number(r.sellable || 0),
                        unavailable: Number(r.unavailable || 0),
                      }
                    : {
                        variantId: r.variantId,
                        purchaseLineId: r.purchaseLineId || null,
                        quantity: Number(r.quantity),
                      },
              )
              .filter(
                (r) =>
                  !("sellable" in r) ||
                  (r.sellable ?? 0) + (r.unavailable ?? 0) > 0,
              );
          const fingerprint = JSON.stringify(data);
          if (pending.current?.fingerprint !== fingerprint)
            pending.current = { fingerprint, key: crypto.randomUUID() };
          const result = await businessApi(endpoint, {
            ...data,
            key: pending.current.key,
          });
          setMessage(
            result.replayed
              ? "Already recorded; no duplicate was created."
              : "Saved successfully.",
          );
          onSaved(result);
        } catch (e) {
          setMessage((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{title}</h2>
      <div className={s.grid}>{fields.map(field)}</div>
      {lineKind && (
        <>
          <h3>
            {lineKind === "receipt"
              ? "Actual acceptance by purchase line"
              : "SKU lines"}
          </h3>
          {rows.map((r, index) => (
            <div
              className={s.grid}
              key={index}
              style={{ borderBottom: "1px solid #ddd", padding: "16px 0" }}
            >
              {lineKind === "receipt" ? (
                <p>
                  {str(obj(r.snapshot).sku) || str(r.variantId)} · Remaining{" "}
                  {str(r.remaining)}
                  <br />
                  Received sellable {str(r.receivedSellable)} / unavailable{" "}
                  {str(r.receivedUnavailable)}
                </p>
              ) : (
                <label className={s.field}>
                  SKU
                  <select
                    required
                    value={str(r.variantId)}
                    onChange={(e) =>
                      setRows(
                        rows.map((l, i) =>
                          i === index
                            ? {
                                ...l,
                                variantId: e.target.value,
                                purchaseLineId: list(meta.purchaseLines).find(
                                  (x) => x.variantId === e.target.value,
                                )?.id,
                              }
                            : l,
                        ),
                      )
                    }
                  >
                    <option value="">Choose SKU</option>
                    {list(meta.skus).map((sku) => (
                      <option key={str(sku.id)} value={str(sku.id)}>
                        {str(sku.sku)} · {str(obj(sku.product).name)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(lineKind === "receipt"
                ? ["sellable", "unavailable"]
                : lineKind === "purchase"
                  ? ["quantity", "unitCost", "supplierCode"]
                  : ["quantity"]
              ).map((k) => (
                <label className={s.field} key={k}>
                  {
                    {
                      sellable: "Sellable accepted",
                      unavailable: "Damaged / awaiting inspection",
                      quantity: "Quantity",
                      unitCost: "Unit cost (selected currency)",
                      supplierCode: "Supplier item code",
                      purchaseLineId: "Purchase line ID (inbound only)",
                    }[k]
                  }
                  <input
                    type={
                      ["quantity", "sellable", "unavailable"].includes(k)
                        ? "number"
                        : "text"
                    }
                    min="0"
                    step="1"
                    value={str(r[k])}
                    required={k !== "supplierCode" && k !== "purchaseLineId"}
                    onChange={(e) =>
                      setRows(
                        rows.map((l, i) =>
                          i === index ? { ...l, [k]: e.target.value } : l,
                        ),
                      )
                    }
                  />
                </label>
              ))}
              {lineKind !== "receipt" && (
                <button
                  type="button"
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                >
                  Remove unsaved line
                </button>
              )}
            </div>
          ))}
          {lineKind !== "receipt" && (
            <button
              type="button"
              onClick={() =>
                setRows([
                  ...rows,
                  {
                    variantId: "",
                    quantity: 1,
                    unitCost: "0.00",
                    supplierCode: "",
                  },
                ])
              }
            >
              Add SKU line
            </button>
          )}
        </>
      )}
      <label className={s.field}>
        Reason / evidence
        <input
          required
          minLength={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button className={s.button} disabled={busy}>
        {busy ? "Saving…" : "Save " + title}
      </button>
      {message && (
        <p role="status" className={s.notice}>
          {message}
        </p>
      )}
    </form>
  );
}
export function Attachments({ type, id }: { type: string; id: string }) {
  const [items, setItems] = useState<Row[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      setItems(
        list(
          (await businessApi(`attachments?objectType=${type}&objectId=${id}`))
            .items,
        ),
      );
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
    <section className={s.box}>
      <h2>Private evidence images</h2>
      <p>
        JPEG, PNG or WebP, up to 8 MB each / 5 per upload. Downloads require
        permission. Financial evidence belongs on the expense or purchase, not a
        shared logistics record.
      </p>
      <button onClick={() => void load()}>Load attachments</button>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await businessApi(
              `attachments?objectType=${type}&objectId=${id}`,
              new FormData(e.currentTarget),
            );
            setMessage("Private attachments saved.");
            await load();
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          type="file"
          name="files"
          accept="image/jpeg,image/png,image/webp"
          multiple
          required
        />
        <button disabled={busy}>Upload private evidence</button>
      </form>
      {items.map((a) => (
        <p key={str(a.id)}>
          <a href={"/api/business/attachment/" + a.id}>
            {str(a.originalName)} · {str(a.sizeBytes)} bytes
          </a>
        </p>
      ))}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
