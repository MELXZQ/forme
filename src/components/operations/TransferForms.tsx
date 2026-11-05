"use client";
import { useState, useRef } from "react";
import {
  MutationForm,
  ops,
  obj,
  list,
  str,
  num,
  reasonField,
  type Row,
  type Field,
} from "./ui";
import s from "./Operations.module.css";
const eta = (v: unknown) =>
  v ? new Date(str(v) + "T00:00:00.000Z").toISOString() : null;
const transportFields: Field[] = [
  { name: "carrier", label: "Carrier" },
  { name: "trackingNumber", label: "Tracking number" },
  { name: "etaStart", label: "Expected in Melbourne — from", type: "date" },
  { name: "etaEnd", label: "Expected in Melbourne — to", type: "date" },
  { name: "notes", label: "Notes", type: "textarea" },
];
export function TransferCreate({
  skus,
  onSaved,
  onClose,
}: {
  skus: Row[];
  onSaved: (v: unknown) => void;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<Row[]>([{ variantId: "", planned: 1 }]);
  return (
    <MutationForm
      title="New Beijing → Melbourne transfer"
      fields={transportFields}
      initial={{
        carrier: "",
        trackingNumber: "",
        etaStart: "",
        etaEnd: "",
        notes: "",
      }}
      onClose={onClose}
      onSaved={onSaved}
      submit={(v) =>
        ops("transfers", {
          ...v,
          etaStart: eta(v.etaStart),
          etaEnd: eta(v.etaEnd),
          lines,
        })
      }
    >
      {() => (
        <>
          <p className={s.muted}>
            A draft does not reduce stock. Confirm actual quantities when goods
            leave Beijing.
          </p>
          {lines.map((line, i) => (
            <div className={s.grid} key={i}>
              <label className={s.field}>
                SKU {i + 1}
                <select
                  required
                  value={str(line.variantId)}
                  onChange={(e) =>
                    setLines((old) =>
                      old.map((l, n) =>
                        n === i ? { ...l, variantId: e.target.value } : l,
                      ),
                    )
                  }
                >
                  <option value="">Choose SKU</option>
                  {skus.map((v) => (
                    <option key={str(v.id)} value={str(v.id)}>
                      {str(v.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={s.field}>
                Planned quantity {i + 1}
                <input
                  type="number"
                  min="1"
                  max="1000000"
                  required
                  value={num(line.planned)}
                  onChange={(e) =>
                    setLines((old) =>
                      old.map((l, n) =>
                        n === i ? { ...l, planned: Number(e.target.value) } : l,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className={s.secondary}
                disabled={lines.length === 1}
                onClick={() => setLines((old) => old.filter((_, n) => n !== i))}
              >
                Remove line
              </button>
            </div>
          ))}
          <button
            type="button"
            className={s.secondary}
            onClick={() =>
              setLines((old) => [...old, { variantId: "", planned: 1 }])
            }
          >
            Add SKU line
          </button>
        </>
      )}
    </MutationForm>
  );
}
export function TransferAction({
  record,
  mode,
  isOwner,
  onSaved,
  onClose,
}: {
  record: Row;
  mode: "dispatch" | "receive" | "return";
  isOwner: boolean;
  onSaved: (v: unknown) => void;
  onClose: () => void;
}) {
  const lines = list(record.lines),
    [values, setValues] = useState<Record<string, Row>>(
      Object.fromEntries(
        lines.map((l) => [
          str(l.id),
          { quantity: 0, sellable: 0, unavailable: 0, lost: 0 },
        ]),
      ),
    ),
    [files, setFiles] = useState<File[]>([]);
  const uploaded = useRef<string[] | null>(null);
  const fields: Field[] = [
    ...(mode === "dispatch"
      ? [
          {
            name: "dispatchedAt",
            label: "Actual dispatch date and time (your device time)",
            type: "datetime-local" as const,
            required: true,
          },
        ]
      : []),
    reasonField,
    ...(mode === "receive"
      ? [{ name: "notes", label: "Receipt notes", type: "textarea" as const }]
      : []),
  ];
  return (
    <MutationForm
      title={
        mode === "dispatch"
          ? "Confirm actual dispatch"
          : mode === "receive"
            ? "Record a partial receipt / confirmed loss"
            : "Record actual return to Beijing"
      }
      fields={fields}
      initial={{
        reason: "",
        ...(mode === "dispatch"
          ? {
              dispatchedAt: "",
            }
          : {}),
        ...(mode === "receive" ? { notes: "" } : {}),
      }}
      onClose={onClose}
      onSaved={onSaved}
      submit={async (v) => {
        const rows: (Row & { lineId: string })[] = lines.map((l) => ({
          lineId: str(l.id),
          ...values[str(l.id)],
        }));
        if (mode === "dispatch")
          return ops(`transfers/${record.id}/dispatch`, {
            key: v.key,
            reason: v.reason,
            dispatchedAt: new Date(str(v.dispatchedAt)).toISOString(),
            lines: rows.map((l) => ({
              lineId: l.lineId,
              quantity: num(l.quantity),
            })),
          });
        if (mode === "return")
          return ops(`transfers/${record.id}/return`, {
            key: v.key,
            reason: v.reason,
            lines: rows
              .filter((l) => num(l.quantity) > 0)
              .map((l) => ({ lineId: l.lineId, quantity: num(l.quantity) })),
          });
        if (files.length && !uploaded.current) {
          const form = new FormData();
          files.forEach((f) => form.append("files", f));
          uploaded.current = (await ops<Row[]>("media", form)).map((m) =>
            str(m.id),
          );
        }
        return ops(`transfers/${record.id}/receive`, {
          key: v.key,
          reason: v.reason,
          notes: v.notes,
          attachmentMediaIds: uploaded.current ?? [],
          lines: rows.map((l) => ({
            lineId: l.lineId,
            sellable: num(l.sellable),
            unavailable: num(l.unavailable),
            lost: isOwner ? num(l.lost) : 0,
          })),
        });
      }}
    >
      {() => (
        <>
          <p className={s.muted}>
            {mode === "receive"
              ? "Enter only goods counted in this receipt. Leave other quantities at zero. Unreceived goods stay in transit. Only the owner can confirm loss."
              : mode === "return"
                ? "Enter goods physically returned to Beijing. They enter unavailable stock pending inspection. After inspection, use Return unavailable stock to sellable."
                : "Stock is checked again now. Enter the quantities actually leaving Beijing."}
          </p>
          <div className={s.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>SKU / product</th>
                  <th>
                    {mode === "dispatch" ? "Planned" : "Still in transit"}
                  </th>
                  {(mode === "receive"
                    ? [
                        "Sellable received",
                        "Unavailable received",
                        ...(isOwner ? ["Confirmed lost"] : []),
                      ]
                    : [
                        mode === "return"
                          ? "Actually returned"
                          : "Actually dispatched",
                      ]
                  ).map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={str(l.id)}>
                    <td>
                      {str(obj(l.variant).sku)}
                      <small>{str(obj(obj(l.variant).product).name)}</small>
                    </td>
                    <td>
                      {str(mode === "dispatch" ? l.planned : l.remaining)}
                    </td>
                    {(mode === "receive"
                      ? [
                          "sellable",
                          "unavailable",
                          ...(isOwner ? ["lost"] : []),
                        ]
                      : ["quantity"]
                    ).map((k) => (
                      <td key={k}>
                        <input
                          aria-label={`${obj(l.variant).sku} ${k}`}
                          type="number"
                          min="0"
                          max={num(
                            mode === "dispatch" ? l.planned : l.remaining,
                          )}
                          value={num(values[str(l.id)]?.[k])}
                          onChange={(e) =>
                            setValues((old) => ({
                              ...old,
                              [str(l.id)]: {
                                ...old[str(l.id)],
                                [k]: Number(e.target.value),
                              },
                            }))
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mode === "receive" && (
            <label className={s.field}>
              Receipt photos (JPEG / PNG / WebP; max 5, 8 MB each)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(e) => {
                  setFiles(Array.from(e.target.files || []));
                  uploaded.current = null;
                }}
              />
            </label>
          )}
        </>
      )}
    </MutationForm>
  );
}
export const transferUpdateFields: Field[] = [
  ...transportFields,
  {
    name: "exception",
    label: "Transport exception (exclude from customer restocking status)",
    type: "checkbox",
  },
  {
    name: "showRestocking",
    label: "Show this shipment as a restocking source",
    type: "checkbox",
  },
  reasonField,
];
export const transferEtaBody = (v: Row) => ({
  ...v,
  etaStart: eta(v.etaStart),
  etaEnd: eta(v.etaEnd),
});
