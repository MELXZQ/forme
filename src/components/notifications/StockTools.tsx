"use client";
import { Select } from "@/components/ui/Select";

import { useState } from "react";
import { api } from "./client";
import { type Row, str, num, list, obj } from "../operations/ui";
import s from "../operations/Operations.module.css";
export function StockTools({
  rows,
  filters,
  total,
  onSaved,
}: {
  rows: Row[];
  filters: Record<string, string>;
  total: number;
  onSaved: () => void;
}) {
  const [ids, setIds] = useState<string[]>([]),
    [all, setAll] = useState(false),
    [warehouse, setWarehouse] = useState("MELBOURNE"),
    [mode, setMode] = useState("CUSTOM"),
    [threshold, setThreshold] = useState("5"),
    [reason, setReason] = useState(""),
    [preview, setPreview] = useState<Row | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState("");
  const reset = () => {
    setPreview(null);
    setMessage("");
  };
  return (
    <details className={s.box}>
      <summary>Stock alert thresholds — single row / batch</summary>
      <p>
        Defaults and custom thresholds are independent for each warehouse. Zero
        means out of stock only. Unconfigured rules are off.
      </p>
      <div className={s.grid}>
        <label>
          Warehouse
          <Select
            aria-label="Warehouse"
            value={warehouse}
            onChange={(e) => {
              setWarehouse(e.target.value);
              reset();
            }}
          >
            <option>BEIJING</option>
            <option>MELBOURNE</option>
          </Select>
        </label>
        <label>
          Mode
          <Select
            aria-label="Mode"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              reset();
            }}
          >
            <option value="CUSTOM">Custom threshold</option>
            <option value="INHERIT">Restore warehouse default</option>
            <option value="OFF">Turn alerts off</option>
          </Select>
        </label>
        {mode === "CUSTOM" && (
          <label>
            Threshold
            <input
              type="number"
              min="0"
              max="1000000"
              value={threshold}
              onChange={(e) => {
                setThreshold(e.target.value);
                reset();
              }}
            />
          </label>
        )}
        <label>
          Reason
          <input
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              reset();
            }}
            minLength={3}
          />
        </label>
      </div>
      <div className={s.actions}>
        <button
          onClick={() => {
            setIds(rows.map((r) => str(r.id)));
            setAll(false);
            reset();
          }}
        >
          Select current page ({rows.length})
        </button>
        <button
          onClick={() => {
            setAll(true);
            setIds([]);
            reset();
          }}
        >
          Select all matching SKUs ({total})
        </button>
        <button
          onClick={() => {
            setIds([]);
            setAll(false);
            reset();
          }}
        >
          Clear selection
        </button>
      </div>
      {!all &&
        rows.map((r) => (
          <label key={str(r.id)} className={s.field}>
            <span>
              <input
                type="checkbox"
                checked={ids.includes(str(r.id))}
                onChange={(e) => {
                  setIds(
                    e.target.checked
                      ? [...ids, str(r.id)]
                      : ids.filter((id) => id !== r.id),
                  );
                  reset();
                }}
              />{" "}
              {str(r.sku)} · {str(r.name)}
            </span>
          </label>
        ))}
      {all && (
        <p>
          Scope: all {total} SKUs matching the current filters, across every
          page.
        </p>
      )}
      <button
        className={s.secondary}
        disabled={busy || (!all && !ids.length)}
        onClick={async () => {
          setBusy(true);
          try {
            const p = await api("preview", {
              warehouse,
              ...(all ? { filters } : { ids }),
            });
            setPreview(p);
            setKey(crypto.randomUUID());
            setMessage(
              "Review the warehouse and affected count before applying.",
            );
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Preview changes
      </button>
      {preview && (
        <div className={s.notice}>
          <p>
            {str(preview.warehouse)} · {num(preview.count)} SKUs · {mode}
            {mode === "CUSTOM" ? ` ${threshold}` : ""}
          </p>
          <button
            className={s.button}
            disabled={busy || reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              try {
                await api("stock", {
                  key,
                  reason,
                  warehouse,
                  mode,
                  threshold: mode === "CUSTOM" ? Number(threshold) : null,
                  ...(all ? { filters } : { ids }),
                  expectedCount: preview.count,
                  previewHash: preview.hash,
                });
                setPreview(null);
                setIds([]);
                setAll(false);
                setMessage(
                  "Thresholds saved. The background checker will update notifications.",
                );
                onSaved();
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Apply reviewed changes
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <p>
        <a href="/admin/notifications?view=rules">
          Change warehouse defaults in notification rules
        </a>
      </p>
    </details>
  );
}
export function ProductChecks() {
  const [data, setData] = useState<Row | null>(null),
    [ids, setIds] = useState<string[]>([]),
    [mode, setMode] = useState("INHERIT"),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className={s.box}>
      <h2>Product information check scope</h2>
      <button
        onClick={async () => {
          try {
            setData(await api("products"));
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        Load product list
      </button>
      {data && (
        <>
          <button
            onClick={() => setIds(list(data.products).map((p) => str(p.id)))}
          >
            Select all {list(data.products).length} products
          </button>
          <button onClick={() => setIds([])}>Clear selection</button>
          {list(data.products).map((p) => (
            <label className={s.field} key={str(p.id)}>
              <span>
                <input
                  type="checkbox"
                  checked={ids.includes(str(p.id))}
                  onChange={(e) =>
                    setIds(
                      e.target.checked
                        ? [...ids, str(p.id)]
                        : ids.filter((id) => id !== p.id),
                    )
                  }
                />
                {str(p.name)} ·{" "}
                {str(
                  obj(list(data.policies).find((r) => r.productId === p.id))
                    .mode,
                ) || "INHERIT"}
              </span>
            </label>
          ))}
          <label>
            Mode
            <Select
              aria-label="Product check mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option>INHERIT</option>
              <option>ON</option>
              <option>OFF</option>
            </Select>
          </label>
          <label>
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <p>
            Apply {mode} to {ids.length} selected products. Publishing
            validation is always enforced.
          </p>
          <button
            className={s.button}
            disabled={busy || !ids.length || reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              try {
                await api("products", {
                  key: crypto.randomUUID(),
                  ids,
                  mode,
                  reason,
                });
                setData(await api("products"));
                setMessage("Product check scope saved.");
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Apply product check scope
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
