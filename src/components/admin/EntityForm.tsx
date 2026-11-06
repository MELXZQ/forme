"use client";
import { Select } from "@/components/ui/Select";

import { useState } from "react";
import s from "./Admin.module.css";
export type Field = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "checkbox" | "select";
  options?: { value: string; label: string }[];
  nullable?: boolean;
  step?: string;
  required?: boolean;
};
export function EntityForm({
  title,
  initial,
  fields,
  onSave,
  onCancel,
}: {
  title: string;
  initial: Record<string, unknown>;
  fields: Field[];
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initial),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  return (
    <form
      className={s.form}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        setMessage("");
        try {
          await onSave(draft);
          setMessage(
            "Saved. The storefront reads the updated content on its next request.",
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : "Save failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>{title}</h2>
      <fieldset className={s.fieldset} disabled={busy}>
        <div className={s.grid}>
          {fields.map((f) => {
            const update = (v: unknown) =>
              setDraft((d) => ({ ...d, [f.name]: v }));
            if (f.type === "checkbox")
              return (
                <label key={f.name} className={s.check}>
                  <input
                    type="checkbox"
                    checked={!!draft[f.name]}
                    onChange={(e) => update(e.target.checked)}
                  />
                  {f.label}
                </label>
              );
            return (
              <label
                key={f.name}
                className={`${s.field} ${f.type === "textarea" ? s.full : ""}`}
              >
                {f.label}
                {f.type === "select" ? (
                  <Select
                    aria-label={f.label}
                    value={String(draft[f.name] ?? "")}
                    onChange={(e) =>
                      update(
                        f.nullable ? e.target.value || null : e.target.value,
                      )
                    }
                    required={f.required}
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : f.type === "textarea" ? (
                  <textarea
                    value={String(draft[f.name] ?? "")}
                    onChange={(e) => update(e.target.value)}
                    required={f.required}
                  />
                ) : (
                  <input
                    type={f.type === "number" ? "number" : "text"}
                    step={f.step || "1"}
                    value={String(draft[f.name] ?? "")}
                    onChange={(e) =>
                      update(
                        f.type === "number"
                          ? Number(e.target.value)
                          : e.target.value,
                      )
                    }
                    required={f.required}
                  />
                )}
              </label>
            );
          })}
        </div>
        <div className={s.actions}>
          <button className={s.button}>{busy ? "Saving…" : "Save"}</button>
          {onCancel && (
            <button type="button" className={s.secondary} onClick={onCancel}>
              Close editor
            </button>
          )}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className={`${s.notice} ${s.error}`}>
          {error}
        </p>
      )}
      {message && (
        <p role="status" className={s.notice}>
          {message}
        </p>
      )}
    </form>
  );
}
