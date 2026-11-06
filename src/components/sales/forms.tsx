"use client";
import { announceAdminChange } from "@/lib/admin-refresh";
import { Select } from "@/components/ui/Select";

import { useState, useRef } from "react";
import { obj, str, type Row } from "../operations/ui";
import s from "../operations/Operations.module.css";
export type Field = {
  name: string;
  label: string;
  type?:
    | "text"
    | "number"
    | "amount"
    | "date"
    | "datetime-local"
    | "textarea"
    | "select"
    | "multi"
    | "checkbox";
  required?: boolean;
  options?: { value: string; label: string }[];
  help?: string;
};
export const f = (
  name: string,
  label: string,
  type: Field["type"] = "text",
  required = false,
): Field => ({ name, label, type, required });
export const options = (values: string[]) =>
  values.map((value) => ({ value, label: value.replaceAll("_", " ") }));
export const choose = (
  name: string,
  label: string,
  values: string[],
  required = false,
): Field => ({
  ...f(name, label, "select", required),
  options: options(values),
});
export const people = (
  rows: Row[],
  name = "assigneeId",
  label = "Responsible person",
): Field => ({
  ...f(name, label, "select", true),
  options: rows.map((r) => ({ value: str(r.id), label: str(r.name) })),
});
export async function api(path: string, body?: unknown) {
  const r = await fetch("/api/sales/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const v = await r.json();
  if (r.status === 401)
    window.location.assign(
      new URL("/admin/login", window.location.origin).href,
    );
  if (!r.ok)
    throw new Error(
      [
        v.error,
        ...(v.details || []).map(
          (d: Row) => str(d.path) + ": " + str(d.message),
        ),
      ].join("\n"),
    );
  if (body !== undefined) announceAdminChange();
  return obj(v.data);
}
export const localInput = (v: unknown) =>
  v
    ? new Date(str(v)).toLocaleString("sv-SE").replace(" ", "T").slice(0, 19)
    : new Date().toLocaleString("sv-SE").replace(" ", "T").slice(0, 19);
export function Form({
  title,
  fields,
  initial = {},
  extra = {},
  endpoint,
  prepare,
  onSaved,
}: {
  title: string;
  fields: Field[];
  initial?: Row;
  extra?: Row;
  endpoint: string;
  prepare?: (v: Row) => Row;
  onSaved: (v: Row) => void;
}) {
  const [values, setValues] = useState<Row>(() =>
      Object.fromEntries(
        fields.map((f) => [
          f.name,
          f.type === "datetime-local"
            ? localInput(initial[f.name])
            : f.type === "amount"
              ? initial[f.name] == null
                ? ""
                : (Number(initial[f.name]) / 100).toFixed(2)
              : f.type === "date"
                ? str(initial[f.name]).slice(0, 10)
                : (initial[f.name] ??
                  (f.type === "multi"
                    ? []
                    : f.type === "checkbox"
                      ? false
                      : "")),
        ]),
      ),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const request = useRef({ payload: "", key: "" });
  return (
    <form
      className={s.box}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          let v: Row = { ...extra };
          for (const field of fields) {
            const raw = values[field.name];
            if ((raw === "" || raw == null) && !field.required) continue;
            let value = raw;
            if (field.type === "number") value = Number(raw);
            if (field.type === "datetime-local")
              value = new Date(str(raw)).toISOString();
            if (field.type === "amount") {
              if (!/^\d+(\.\d{1,2})?$/.test(str(raw)))
                throw new Error("Enter money with at most 2 decimal places");
              const [whole, frac = ""] = str(raw).split(".");
              value = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
            }
            v[field.name] = value;
          }
          if (prepare) v = prepare(v);
          const payload = JSON.stringify(v);
          if (request.current.payload !== payload)
            request.current = { payload, key: crypto.randomUUID() };
          onSaved(await api(endpoint, { ...v, key: request.current.key }));
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{title}</h2>
      <fieldset disabled={busy}>
        <div className={s.grid}>
          {fields.map((field) => (
            <label key={field.name}>
              {field.label}
              {field.type === "textarea" ? (
                <textarea
                  required={field.required}
                  value={str(values[field.name])}
                  onChange={(e) =>
                    setValues({ ...values, [field.name]: e.target.value })
                  }
                />
              ) : field.type === "select" || field.type === "multi" ? (
                <Select
                  aria-label={field.label}
                  multiple={field.type === "multi"}
                  required={field.required}
                  value={
                    field.type === "multi"
                      ? (values[field.name] as string[])
                      : str(values[field.name])
                  }
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [field.name]:
                        field.type === "multi"
                          ? [...e.target.selectedOptions].map((o) => o.value)
                          : e.target.value,
                    })
                  }
                >
                  {field.type !== "multi" && <option value="">Choose…</option>}
                  {field.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : field.type === "checkbox" ? (
                <input
                  type="checkbox"
                  checked={!!values[field.name]}
                  onChange={(e) =>
                    setValues({ ...values, [field.name]: e.target.checked })
                  }
                />
              ) : (
                <input
                  type={field.type === "amount" ? "text" : field.type || "text"}
                  step={field.type === "datetime-local" ? 1 : undefined}
                  inputMode={field.type === "amount" ? "decimal" : undefined}
                  required={field.required}
                  value={str(values[field.name])}
                  onChange={(e) =>
                    setValues({ ...values, [field.name]: e.target.value })
                  }
                />
              )}{" "}
              {field.help && <small>{field.help}</small>}
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      <button className={s.button} disabled={busy}>
        {busy ? "Saving…" : "Save " + title}
      </button>
    </form>
  );
}
export const reason = f(
  "reason",
  "Reason / evidence summary",
  "textarea",
  true,
);
export const occurred = f(
  "occurredAt",
  "Actual event time (your local timezone)",
  "datetime-local",
  true,
);
