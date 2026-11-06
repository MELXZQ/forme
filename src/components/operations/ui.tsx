"use client";
import { announceAdminChange } from "@/lib/admin-refresh";
import { Select } from "@/components/ui/Select";

import { useRef, useState, type ReactNode } from "react";
import s from "./Operations.module.css";
export type Row = Record<string, unknown>;
export const obj = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
export const list = (v: unknown): Row[] => (Array.isArray(v) ? v.map(obj) : []);
export const str = (v: unknown) => (v == null ? "" : String(v));
export const num = (v: unknown) => Number(v) || 0;
export const day = (v: unknown) =>
  v ? new Date(str(v)).toISOString().slice(0, 10) : "";
export const dateTime = (v: unknown) =>
  v
    ? new Date(str(v)).toLocaleString("en-AU", {
        timeZone: "Australia/Melbourne",
      })
    : "—";
export async function ops<T = unknown>(
  path: string,
  body?: unknown,
): Promise<T> {
  const r = await fetch(`/api/operations/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await r.json();
  if (r.status === 401)
    window.location.assign(
      new URL("/admin/login", window.location.origin).href,
    );
  if (!r.ok)
    throw new Error(
      [
        data.error,
        ...(data.details || []).map(
          (d: { path: string; message: string }) => `${d.path}: ${d.message}`,
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  if (body !== undefined && typeof BroadcastChannel !== "undefined") {
    const c = new BroadcastChannel("forme-catalog");
    c.postMessage("updated");
    c.close();
  }
  if (body !== undefined) announceAdminChange();
  return data.data as T;
}
export type Field = {
  name: string;
  label: string;
  type?:
    | "text"
    | "number"
    | "textarea"
    | "password"
    | "date"
    | "datetime-local"
    | "checkbox"
    | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
  min?: number;
  max?: number;
  help?: string;
};
export function Inputs({
  fields,
  value,
  onChange,
}: {
  fields: Field[];
  value: Row;
  onChange: (v: Row) => void;
}) {
  return (
    <div className={s.grid}>
      {fields.map((f) => (
        <label
          className={f.type === "textarea" ? s.wide : s.field}
          key={f.name}
        >
          {f.label}
          {f.type === "checkbox" ? (
            <input
              type="checkbox"
              checked={!!value[f.name]}
              onChange={(e) =>
                onChange({ ...value, [f.name]: e.target.checked })
              }
            />
          ) : f.type === "select" ? (
            <Select
              aria-label={f.label}
              value={str(value[f.name])}
              required={f.required}
              onChange={(e) => onChange({ ...value, [f.name]: e.target.value })}
            >
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : f.type === "textarea" ? (
            <textarea
              required={f.required}
              minLength={f.name === "reason" ? 3 : undefined}
              maxLength={2000}
              value={str(value[f.name])}
              onChange={(e) => onChange({ ...value, [f.name]: e.target.value })}
            />
          ) : (
            <input
              type={f.type || "text"}
              min={f.min}
              max={f.max}
              step={f.type === "number" ? 1 : undefined}
              minLength={f.type === "password" ? 12 : undefined}
              maxLength={f.type === "password" ? 128 : 500}
              autoComplete={f.type === "password" ? "new-password" : undefined}
              required={f.required}
              value={str(value[f.name])}
              onChange={(e) =>
                onChange({
                  ...value,
                  [f.name]:
                    f.type === "number"
                      ? Number(e.target.value)
                      : e.target.value,
                })
              }
            />
          )}{" "}
          {f.help && <small>{f.help}</small>}
        </label>
      ))}
    </div>
  );
}
export const reasonField: Field = {
  name: "reason",
  label: "Reason",
  type: "textarea",
  required: true,
};
export function MutationForm({
  title,
  fields = [],
  initial = {},
  submit,
  onSaved,
  onClose,
  children,
}: {
  title: string;
  fields?: Field[];
  initial?: Row;
  submit: (v: Row) => Promise<unknown>;
  onSaved: (result: unknown) => void;
  onClose?: () => void;
  children?: (value: Row, set: (v: Row) => void) => ReactNode;
}) {
  const [value, setValue] = useState<Row>(initial),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  const requestKey = useRef(crypto.randomUUID());
  return (
    <form
      className={s.box}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const result = await submit({ ...value, key: requestKey.current });
          setDone(true);
          onSaved(result);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Operation failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className={s.heading}>
        <h2>{title}</h2>
        {onClose && (
          <button type="button" className={s.secondary} onClick={onClose}>
            Close form
          </button>
        )}
      </div>
      <fieldset disabled={busy || done}>
        <Inputs fields={fields} value={value} onChange={setValue} />
        {children?.(value, setValue)}
        <button className={s.button}>
          {busy ? "Saving…" : done ? "Saved" : "Confirm and save"}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {done && (
        <p role="status" className={s.notice}>
          Saved. Close this form before starting another operation.
        </p>
      )}
    </form>
  );
}
export function Table({
  rows,
  columns,
  select,
}: {
  rows: Row[];
  columns: { key: string; label: string; render?: (row: Row) => ReactNode }[];
  select?: (row: Row) => void;
}) {
  return (
    <div
      className={s.tableWrap}
      tabIndex={0}
      role="region"
      aria-label="Records table, scroll horizontally for more columns"
    >
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            {select && <th>Details</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={str(r.id) || i}>
              {columns.map((c) => (
                <td key={c.key}>
                  {c.render
                    ? c.render(r)
                    : str(
                        c.key
                          .split(".")
                          .reduce<unknown>((v, k) => obj(v)[k], r),
                      ) || "—"}
                </td>
              ))}
              {select && (
                <td>
                  <button className={s.linkButton} onClick={() => select(r)}>
                    Open
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className={s.muted}>No matching records.</p>}
    </div>
  );
}
export function Timeline({ rows }: { rows: Row[] }) {
  return (
    <ol className={s.timeline}>
      {rows.map((r) => (
        <li key={str(r.id)}>
          <strong>{str(r.action)}</strong> · {dateTime(r.createdAt)}
          {!!r.actorId && <small>By {str(r.actorName || r.actorId)}</small>}
          {!!r.reason && <p>{str(r.reason)}</p>}
        </li>
      ))}
    </ol>
  );
}
