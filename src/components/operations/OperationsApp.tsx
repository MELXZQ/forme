"use client";
import { Select } from "@/components/ui/Select";

import { StockTools } from "../notifications/StockTools";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Asset } from "../Asset";
import { money } from "@/lib/format";
import { availabilityLabel, type AvailabilityStatus } from "@/lib/availability";
import {
  ops,
  obj,
  list,
  str,
  num,
  day,
  dateTime,
  MutationForm,
  Table,
  Timeline,
  reasonField,
  type Row,
  type Field,
} from "./ui";
import {
  TransferCreate,
  TransferAction,
  transferUpdateFields,
  transferEtaBody,
} from "./TransferForms";
import s from "./Operations.module.css";
type Actor = { id: string; role: "admin" | "warehouse" | "viewer" };
const roleLabels = {
  admin: "Owner",
  warehouse: "Melbourne warehouse",
  viewer: "Read-only inventory",
};
const warehouseOptions = [
  { value: "BEIJING", label: "Beijing" },
  { value: "MELBOURNE", label: "Melbourne" },
];
const roleOptions = Object.entries(roleLabels).map(([value, label]) => ({
  value,
  label,
}));
export function OperationsApp({ actor }: { actor: Actor }) {
  const params = useSearchParams(),
    router = useRouter(),
    owner = actor.role === "admin",
    writer = actor.role !== "viewer";
  const sections = owner
    ? [
        "inventory",
        "transfers",
        "counts",
        "orders",
        "accounts",
        "settings",
        "history",
      ]
    : actor.role === "warehouse"
      ? ["inventory", "transfers", "counts", "orders"]
      : ["inventory", "transfers", "counts"];
  const section = sections.includes(params.get("section") || "")
      ? params.get("section")!
      : "inventory",
    id = params.get("id") || "",
    query = params.toString();
  const [record, setRecord] = useState<{ query: string; value: Row } | null>(
      null,
    ),
    [lookup, setLookup] = useState<Row>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [action, setAction] = useState("");
  const generation = useRef(0);
  const data = record?.query === query ? record.value : null;
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const load = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true);
    try {
      const detail =
        id && ["inventory", "transfers", "orders"].includes(section)
          ? `/${id}`
          : "";
      const [raw, look] = await Promise.all([
        ops(`${section}${detail}?${query}`),
        ops<Row>("lookup"),
      ]);
      if (version === generation.current) {
        setRecord({
          query,
          value: Array.isArray(raw) ? { items: raw } : obj(raw),
        });
        setLookup(look);
        setError("");
      }
    } catch (e) {
      if (version === generation.current)
        setError(e instanceof Error ? e.message : "Loading failed.");
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }, [id, section, query]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setAction("");
        setNotice("");
        void load();
      }
    });
    return () => {
      cancelled = true;
      invalidate();
    };
  }, [load, invalidate]);
  const go = (item: string, nextId = "") => {
    const q =
      item === section ? new URLSearchParams(params) : new URLSearchParams();
    q.set("section", item);
    if (nextId) q.set("id", nextId);
    else q.delete("id");
    router.push(`/admin/operations?${q}`);
  };
  const saved = (result: unknown) => {
    setNotice("Saved. Inventory and storefront data have been updated.");
    const newId = str(obj(result).id);
    if (action === "new-transfer" && newId) go("transfers", newId);
    else void load();
  };
  const fieldsForWarehouse: Field = {
    name: "warehouse",
    label: "Warehouse",
    type: "select",
    options: owner
      ? [
          { value: "", label: "Choose confirmed warehouse" },
          ...warehouseOptions,
        ]
      : [warehouseOptions[1]],
    required: true,
  };
  const close = () => setAction("");
  const rows = list(data?.items),
    skus = list(lookup.skus),
    categories = list(lookup.categories),
    collections = list(lookup.collections);
  const selected = rows.find((r) => str(r.id) === id);
  const inventory = obj(data?.sku);
  const orderLines = list(data?.lines);
  const renderForm = () => {
    if (!data || !action) return null;
    if (action === "new-transfer")
      return <TransferCreate skus={skus} onSaved={saved} onClose={close} />;
    if (["dispatch", "receive", "return-transfer"].includes(action))
      return (
        <TransferAction
          record={data}
          mode={
            action === "return-transfer"
              ? "return"
              : (action as "dispatch" | "receive")
          }
          isOwner={owner}
          onSaved={saved}
          onClose={close}
        />
      );
    if (action === "resolve-legacy")
      return (
        <MutationForm
          title="Confirm an old unassigned quantity does not physically exist"
          fields={[
            {
              name: "quantity",
              label: "Confirmed nonexistent legacy quantity",
              type: "number",
              min: 1,
              required: true,
            },
            reasonField,
          ]}
          initial={{ quantity: 1, reason: "" }}
          onSaved={saved}
          onClose={close}
          submit={(v) =>
            ops("inventory/resolve-legacy", { ...v, variantId: id })
          }
        />
      );
    if (action === "movement")
      return (
        <MutationForm
          title="Record stock event"
          fields={[
            fieldsForWarehouse,
            {
              name: "kind",
              label: "Stock event",
              type: "select",
              options: [
                { value: "LEGACY", label: "Assign confirmed legacy stock" },
                { value: "INITIAL", label: "Initial physical stock entry" },
                { value: "PURCHASE", label: "Purchase received" },
                {
                  value: "DAMAGE",
                  label: "Move available stock to unavailable",
                },
                {
                  value: "RESTORE",
                  label: "Return unavailable stock to sellable",
                },
                {
                  value: "LOSS",
                  label: "Confirmed disposal/loss of unavailable stock",
                },
              ],
            },
            {
              name: "quantity",
              label: "Quantity for this event",
              type: "number",
              min: 1,
              required: true,
            },
            {
              name: "unavailableQuantity",
              label:
                "Of received quantity: unavailable / awaiting inspection (initial, purchase or legacy only)",
              type: "number",
              min: 0,
            },
            reasonField,
          ]}
          initial={{
            warehouse: owner ? "" : "MELBOURNE",
            kind: num(inventory.legacyRemaining) > 0 ? "LEGACY" : "PURCHASE",
            quantity: 1,
            unavailableQuantity: 0,
            reason: "",
          }}
          onSaved={saved}
          onClose={close}
          submit={(v) => ops("inventory/movement", { ...v, variantId: id })}
        />
      );
    if (action === "count")
      return (
        <MutationForm
          title="Submit a physical stock count — owner approval required"
          fields={[
            fieldsForWarehouse,
            {
              name: "countedOnHand",
              label: "Actual physical quantity counted",
              type: "number",
              min: 0,
              required: true,
            },
            reasonField,
          ]}
          initial={{ warehouse: "MELBOURNE", countedOnHand: 0, reason: "" }}
          onSaved={saved}
          onClose={close}
          submit={(v) => ops("inventory/count", { ...v, variantId: id })}
        />
      );
    if (action === "policy")
      return (
        <MutationForm
          title="SKU storefront restocking visibility"
          fields={[
            {
              name: "showRestocking",
              label: "Show genuine replenishment sources to customers",
              type: "checkbox",
            },
            reasonField,
          ]}
          initial={{
            showRestocking: obj(inventory.policy).showRestocking !== false,
            reason: "",
          }}
          submit={(v) => ops("inventory/policy", { ...v, variantId: id })}
          onSaved={saved}
          onClose={close}
        />
      );
    if (action === "transfer-update")
      return (
        <MutationForm
          title="Update shipment / expected arrival"
          fields={transferUpdateFields}
          initial={{
            carrier: str(data.carrier),
            trackingNumber: str(data.trackingNumber),
            etaStart: day(data.etaStart),
            etaEnd: day(data.etaEnd),
            exception: !!data.exception,
            showRestocking: !!data.showRestocking,
            notes: str(data.notes),
            reason: "",
          }}
          submit={(v) => ops(`transfers/${id}/update`, transferEtaBody(v))}
          onSaved={saved}
          onClose={close}
        />
      );
    if (action === "transfer-cancel")
      return (
        <MutationForm
          title="Cancel unsent draft"
          fields={[reasonField]}
          initial={{ reason: "" }}
          submit={(v) => ops(`transfers/${id}/cancel`, v)}
          onSaved={saved}
          onClose={close}
        />
      );
    if (action === "count-decision" && selected)
      return (
        <MutationForm
          title={`Decide count for ${obj(selected.variant).sku}`}
          fields={[
            {
              name: "approved",
              label: "Approve (uncheck to reject)",
              type: "checkbox",
            },
            reasonField,
          ]}
          initial={{ approved: true, reason: "" }}
          submit={(v) => ops(`counts/${selected.id}/decision`, v)}
          onSaved={saved}
          onClose={close}
        />
      );
    if (action === "new-account")
      return (
        <MutationForm
          title="Create a personal staff account"
          fields={[
            { name: "name", label: "Display name", required: true },
            { name: "email", label: "Login email", required: true },
            {
              name: "password",
              label: "Initial password (12–128 characters)",
              type: "password",
              required: true,
            },
            {
              name: "role",
              label: "Permission",
              type: "select",
              options: roleOptions,
            },
            reasonField,
          ]}
          initial={{
            name: "",
            email: "",
            password: "",
            role: "warehouse",
            reason: "",
          }}
          submit={(v) => ops("accounts", v)}
          onSaved={saved}
          onClose={close}
        />
      );
    if (action === "account-update" && selected)
      return (
        <MutationForm
          title={`Permissions — ${selected.name}`}
          fields={[
            {
              name: "role",
              label: "Permission",
              type: "select",
              options: roleOptions,
            },
            { name: "active", label: "Account active", type: "checkbox" },
            reasonField,
          ]}
          initial={{
            role: str(selected.role),
            active: !!selected.active,
            reason: "",
          }}
          submit={(v) => ops(`accounts/${selected.id}`, v)}
          onSaved={saved}
          onClose={close}
        />
      );
    if (action === "ship")
      return (
        <MutationForm
          title="Confirm whole-order shipment from Melbourne"
          fields={[
            { name: "carrier", label: "Carrier", required: true },
            {
              name: "trackingNumber",
              label: "Tracking number",
              required: true,
            },
            reasonField,
          ]}
          initial={{ carrier: "", trackingNumber: "", reason: "" }}
          submit={(v) => ops(`orders/${id}/ship`, v)}
          onSaved={saved}
          onClose={close}
        />
      );
    if (action === "order-cancel")
      return (
        <MutationForm
          title="Cancel unshipped order (no refund is processed)"
          fields={[reasonField]}
          initial={{ reason: "" }}
          submit={(v) => ops(`orders/${id}/cancel`, v)}
          onSaved={saved}
          onClose={close}
        />
      );
    if (action === "order-return")
      return (
        <MutationForm
          title="Register goods physically returned and inspected — no refund"
          fields={[
            {
              name: "lineId",
              label: "Order item",
              type: "select",
              options: [
                { value: "", label: "Choose item" },
                ...orderLines.map((l) => ({
                  value: str(l.id),
                  label: `${l.productName} · ${l.sku} · shipped ${l.quantity}`,
                })),
              ],
              required: true,
            },
            {
              name: "sellable",
              label: "Returned sellable quantity",
              type: "number",
              min: 0,
            },
            {
              name: "unavailable",
              label: "Returned unavailable quantity",
              type: "number",
              min: 0,
            },
            reasonField,
          ]}
          initial={{ lineId: "", sellable: 0, unavailable: 0, reason: "" }}
          submit={(v) => ops(`orders/${id}/return`, v)}
          onSaved={saved}
          onClose={close}
        />
      );
    if (action === "simulate")
      return (
        <MutationForm
          title="DEV payment simulation — no real charge"
          fields={[
            {
              name: "outcome",
              label: "Simulated outcome",
              type: "select",
              options: [
                { value: "success", label: "Success" },
                { value: "failure", label: "Failure" },
              ],
            },
            reasonField,
          ]}
          initial={{ outcome: "success", reason: "" }}
          submit={(v) =>
            ops(`orders/${id}/simulate-payment`, { ...v, eventId: str(v.key) })
          }
          onSaved={saved}
          onClose={close}
        />
      );
    return null;
  };
  return (
    <div className={s.root} data-admin>
      <main id="main" className={s.content}>
        <p className={s.titleNote}>
          {roleLabels[actor.role]} · Times shown in Melbourne. Date-range
          filters use UTC. No real payment or refund service is connected.
        </p>
        <div className={s.heading}>
          <h1>
            {id && ["inventory", "transfers", "orders"].includes(section)
              ? section === "inventory"
                ? str(inventory.name) || "SKU details"
                : str(data?.number) || "Details"
              : section[0].toUpperCase() + section.slice(1)}
          </h1>
          <div className={s.actions}>
            {id && (
              <button className={s.secondary} onClick={() => go(section)}>
                Back to list
              </button>
            )}
            {owner && section === "transfers" && !id && (
              <button
                className={s.button}
                onClick={() => setAction("new-transfer")}
              >
                New transfer
              </button>
            )}
            {owner && section === "accounts" && (
              <button
                className={s.button}
                onClick={() => setAction("new-account")}
              >
                New account
              </button>
            )}
            <button className={s.secondary} onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className={s.notice}>
            {notice}
          </p>
        )}
        {loading && <p role="status">Loading operations…</p>}
        {data && (
          <>
            {section === "inventory" && !id && (
              <>
                <p className={s.muted}>
                  Physical − reserved − unavailable = available. Unassigned
                  legacy stock is excluded from both warehouses. Low stock uses
                  the selected warehouse’s effective threshold (Melbourne by
                  default).
                </p>
                <p className={s.notice} role="status">
                  {params.get("warehouse") === "BEIJING"
                    ? "Beijing"
                    : "Melbourne"}{" "}
                  low stock: {num(obj(data.alerts).lowStock)} SKUs · Overdue
                  transfers: {num(obj(data.alerts).overdue)} SKUs · Pending
                  counts: {num(obj(data.alerts).pendingCounts)}
                  {owner && (
                    <>
                      {" "}
                      · Unassigned legacy quantity:{" "}
                      {num(obj(data.alerts).legacyUnassigned)}
                    </>
                  )}
                  . Use the filters below to review each reminder.
                </p>
                <Filters
                  key={query}
                  section={section}
                  params={params}
                  categories={categories}
                  collections={collections}
                  owner={owner}
                />
                {owner && (
                  <StockTools
                    key={`stock-tools:${query}`}
                    rows={rows}
                    filters={Object.fromEntries(params)}
                    total={num(data.total)}
                    onSaved={() => void load()}
                  />
                )}
                <Table
                  rows={rows}
                  columns={[
                    { key: "thresholdSource", label: "Alert source" },
                    {
                      key: "lowStockThreshold",
                      label: "Effective threshold",
                      render: (r) =>
                        r.lowStockThreshold === null
                          ? "Off"
                          : str(r.lowStockThreshold),
                    },
                    {
                      key: "image",
                      label: "",
                      render: (r) =>
                        r.image ? (
                          <Asset
                            src={str(r.image)}
                            alt={str(r.name)}
                            className={s.thumbnail}
                          />
                        ) : null,
                    },
                    {
                      key: "name",
                      label: "Product / SKU",
                      render: (r) => (
                        <>
                          {str(r.name)}
                          <small>
                            {str(r.sku)} · {str(r.size)} / {str(r.color)}
                          </small>
                        </>
                      ),
                    },
                    { key: "productStatus", label: "Product state" },
                    {
                      key: "enabled",
                      label: "SKU enabled",
                      render: (r) => (r.enabled ? "Yes" : "No"),
                    },
                    {
                      key: "category",
                      label: "Category / collections",
                      render: (r) => (
                        <>
                          {str(r.category)}
                          <small>
                            {list(r.collections)
                              .map((c) => str(c.name))
                              .join(", ")}
                          </small>
                        </>
                      ),
                    },
                    ...(owner || actor.role === "viewer"
                      ? [
                          { key: "beijing.onHand", label: "BJ physical" },
                          {
                            key: "beijing.unavailable",
                            label: "BJ unavailable",
                          },
                          { key: "beijing.available", label: "BJ available" },
                        ]
                      : []),
                    { key: "inTransit", label: "In transit" },
                    { key: "etaEnd", label: "Next valid ETA" },
                    { key: "melbourne.onHand", label: "MEL physical" },
                    { key: "melbourne.reserved", label: "MEL reserved" },
                    { key: "melbourne.unavailable", label: "MEL unavailable" },
                    { key: "melbourne.available", label: "MEL available" },
                    ...(owner
                      ? [{ key: "legacyRemaining", label: "Legacy unassigned" }]
                      : []),
                    {
                      key: "availability",
                      label: "Stock state",
                      render: (r) =>
                        availabilityLabel(
                          str(r.availability) as AvailabilityStatus,
                        ),
                    },
                  ]}
                  select={(r) => go(section, str(r.id))}
                />
                {writer && <ExportLink section="inventory" query={query} />}
              </>
            )}
            {section === "inventory" && id && (
              <>
                <p>
                  {str(inventory.sku)} · {str(inventory.size)} /{" "}
                  {str(inventory.color)} · {str(inventory.category)} ·{" "}
                  {str(inventory.productStatus)}
                </p>
                {owner && (
                  <p className={s.notice}>
                    Unassigned legacy quantity: {num(inventory.legacyRemaining)}
                    . Confirm the real warehouse, then use “Assign confirmed
                    legacy stock”.
                  </p>
                )}
                <Table
                  rows={list(inventory.balances)}
                  columns={[
                    { key: "warehouse", label: "Warehouse" },
                    { key: "onHand", label: "Physical" },
                    { key: "reserved", label: "Reserved" },
                    { key: "unavailable", label: "Unavailable" },
                    { key: "available", label: "Available" },
                  ]}
                />
                <div className={s.actions}>
                  {owner && (
                    <button
                      className={s.button}
                      onClick={() => setAction("movement")}
                    >
                      Record stock event
                    </button>
                  )}
                  {writer && (
                    <button
                      className={s.secondary}
                      onClick={() => setAction("count")}
                    >
                      Submit physical count
                    </button>
                  )}
                  {owner && (
                    <button
                      className={s.secondary}
                      onClick={() => setAction("policy")}
                    >
                      SKU alerts / restocking
                    </button>
                  )}
                </div>
                <div key={`${section}-${id}-${action}`}>{renderForm()}</div>
                {owner && num(inventory.legacyRemaining) > 0 && (
                  <button
                    className={s.secondary}
                    onClick={() => setAction("resolve-legacy")}
                  >
                    Resolve legacy discrepancy
                  </button>
                )}
                <h2>Inventory ledger</h2>
                <Table
                  rows={list(data.ledger)}
                  columns={[
                    {
                      key: "createdAt",
                      label: "When",
                      render: (r) => dateTime(r.createdAt),
                    },
                    { key: "warehouse", label: "Warehouse" },
                    { key: "kind", label: "Event" },
                    { key: "deltaOnHand", label: "Δ physical" },
                    { key: "deltaReserved", label: "Δ reserved" },
                    { key: "deltaUnavailable", label: "Δ unavailable" },
                    { key: "deltaInTransit", label: "Δ transit" },
                    { key: "beforeOnHand", label: "Before physical" },
                    { key: "beforeReserved", label: "Before reserved" },
                    { key: "beforeUnavailable", label: "Before unavailable" },
                    { key: "afterOnHand", label: "After physical" },
                    { key: "afterReserved", label: "After reserved" },
                    { key: "afterUnavailable", label: "After unavailable" },
                    { key: "actorName", label: "Operator" },
                    { key: "reason", label: "Reason" },
                    { key: "documentId", label: "Document" },
                  ]}
                />
                <h2>Related transfers</h2>
                <Table
                  rows={list(data.transfers).map((l) => ({
                    ...l,
                    number: obj(l.transfer).number,
                    status: obj(l.transfer).status,
                    id: l.transferId,
                  }))}
                  columns={[
                    { key: "number", label: "Transfer" },
                    { key: "status", label: "State" },
                    { key: "sent", label: "Dispatched" },
                    { key: "receivedSellable", label: "Sellable received" },
                    {
                      key: "receivedUnavailable",
                      label: "Unavailable received",
                    },
                    { key: "lost", label: "Lost" },
                    { key: "returned", label: "Returned to Beijing" },
                  ]}
                  select={(r) => go("transfers", str(r.id))}
                />
                <h2>Active order reservations</h2>
                <Table
                  rows={list(data.reservations)}
                  columns={[
                    { key: "order.number", label: "Order" },
                    { key: "quantity", label: "Reserved" },
                    { key: "order.paymentStatus", label: "Payment" },
                    {
                      key: "order.expiresAt",
                      label: "Expiry",
                      render: (r) => dateTime(obj(r.order).expiresAt),
                    },
                  ]}
                />
              </>
            )}
            {section === "transfers" && !id && (
              <>
                <Filters
                  key={query}
                  section={section}
                  params={params}
                  categories={categories}
                  collections={collections}
                  owner={owner}
                />
                <div key={`${section}-${id}-${action}`}>{renderForm()}</div>
                <Table
                  rows={rows}
                  columns={[
                    { key: "number", label: "Transfer" },
                    { key: "status", label: "State" },
                    { key: "trackingNumber", label: "Tracking" },
                    {
                      key: "dispatchedAt",
                      label: "Dispatched",
                      render: (r) => dateTime(r.dispatchedAt),
                    },
                    {
                      key: "etaStart",
                      label: "ETA from",
                      render: (r) => day(r.etaStart) || "—",
                    },
                    {
                      key: "etaEnd",
                      label: "ETA to",
                      render: (r) => day(r.etaEnd) || "—",
                    },
                    { key: "remaining", label: "Still in transit" },
                    {
                      key: "overdue",
                      label: "Overdue",
                      render: (r) =>
                        r.overdue ? "Overdue — review ETA" : "No",
                    },
                    {
                      key: "exception",
                      label: "Exception",
                      render: (r) => (r.exception ? "Yes" : "No"),
                    },
                  ]}
                  select={(r) => go(section, str(r.id))}
                />
              </>
            )}
            {section === "transfers" && id && (
              <>
                <p>
                  Beijing → Melbourne · <strong>{str(data.status)}</strong> ·{" "}
                  {str(data.carrier)} · {str(data.trackingNumber)}
                </p>
                <p className={s.muted}>
                  Expected Melbourne arrival:{" "}
                  {day(data.etaStart) || "not supplied"} –{" "}
                  {day(data.etaEnd) || "not supplied"}. This is not a customer
                  delivery promise.
                </p>
                {!!data.exception && (
                  <p className={s.error}>
                    Transport exception: excluded from normal customer
                    restocking status.
                  </p>
                )}
                <Table
                  rows={orderLines}
                  columns={[
                    { key: "variant.sku", label: "SKU" },
                    { key: "variant.product.name", label: "Product" },
                    { key: "planned", label: "Planned" },
                    { key: "sent", label: "Dispatched" },
                    { key: "receivedSellable", label: "Received sellable" },
                    {
                      key: "receivedUnavailable",
                      label: "Received unavailable",
                    },
                    { key: "lost", label: "Confirmed lost" },
                    { key: "returned", label: "Returned to Beijing" },
                    { key: "remaining", label: "Remaining" },
                  ]}
                />
                <div className={s.actions}>
                  {owner && data.status === "DRAFT" && (
                    <>
                      <button
                        className={s.button}
                        onClick={() => setAction("dispatch")}
                      >
                        Confirm dispatch
                      </button>
                      <button
                        className={s.secondary}
                        onClick={() => setAction("transfer-cancel")}
                      >
                        Cancel draft
                      </button>
                    </>
                  )}
                  {writer && ["SENT", "PARTIAL"].includes(str(data.status)) && (
                    <button
                      className={s.button}
                      onClick={() => setAction("receive")}
                    >
                      Record partial receipt
                    </button>
                  )}
                  {owner && ["SENT", "PARTIAL"].includes(str(data.status)) && (
                    <button
                      className={s.secondary}
                      onClick={() => setAction("return-transfer")}
                    >
                      Returned to Beijing
                    </button>
                  )}
                  {owner &&
                    !["CLOSED", "CANCELLED"].includes(str(data.status)) && (
                      <button
                        className={s.secondary}
                        onClick={() => setAction("transfer-update")}
                      >
                        Update shipment / ETA
                      </button>
                    )}
                </div>
                <div key={`${section}-${id}-${action}`}>{renderForm()}</div>
                <h2>Receipt and return records</h2>
                {list(data.receipts).map((r) => (
                  <div className={s.receipt} key={str(r.id)}>
                    <strong>
                      {str(r.kind)} · {dateTime(r.createdAt)} ·{" "}
                      {str(r.actorName || r.actorId)}
                    </strong>
                    <p>
                      {str(r.reason)} · {str(r.notes)}
                    </p>
                    <Table
                      rows={list(r.lines)}
                      columns={[
                        {
                          key: "transferLineId",
                          label: "SKU",
                          render: (r) =>
                            str(
                              obj(
                                orderLines.find(
                                  (l) => l.id === r.transferLineId,
                                )?.variant,
                              ).sku,
                            ) || str(r.transferLineId),
                        },
                        { key: "sellable", label: "Sellable" },
                        { key: "unavailable", label: "Unavailable" },
                        { key: "lost", label: "Lost" },
                        { key: "returned", label: "Returned" },
                      ]}
                    />
                    {list(r.attachments).map((a) => (
                      <a
                        key={str(a.mediaId)}
                        href={`/api/operations/media/${a.mediaId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View receipt photo ↗{" "}
                      </a>
                    ))}
                  </div>
                ))}
                <h2>Operation history</h2>
                <Timeline rows={list(data.history)} />
              </>
            )}
            {section === "counts" && (
              <>
                {owner && selected && str(selected.status) === "PENDING" && (
                  <button
                    className={s.button}
                    onClick={() => setAction("count-decision")}
                  >
                    Decide selected count
                  </button>
                )}
                <div key={`${section}-${id}-${action}`}>{renderForm()}</div>
                <Table
                  rows={rows}
                  columns={[
                    { key: "variant.sku", label: "SKU" },
                    { key: "warehouse", label: "Warehouse" },
                    { key: "expectedOnHand", label: "Physical at submission" },
                    { key: "countedOnHand", label: "Counted physical" },
                    { key: "status", label: "State" },
                    { key: "reason", label: "Reason" },
                    { key: "submittedBy", label: "Submitted by" },
                    { key: "decidedBy", label: "Decided by" },
                    { key: "decisionReason", label: "Decision reason" },
                  ]}
                  select={owner ? (r) => go("counts", str(r.id)) : undefined}
                />
                <p className={s.muted}>
                  Counts do not change inventory until the owner approves. If
                  physical stock changes meanwhile, recount before approval.
                </p>
              </>
            )}
            {section === "orders" && !id && (
              <>
                <p className={s.notice}>
                  Legacy operational totals include simulations and
                  reference-price differences. Use{" "}
                  <Link href="/admin/sales?section=analytics">
                    Sales & cash
                  </Link>{" "}
                  for verified real sales and actual discounts.
                </p>
                <Filters
                  key={query}
                  section={section}
                  params={params}
                  categories={
                    list(obj(data.facets).categories).length
                      ? list(obj(data.facets).categories)
                      : categories
                  }
                  collections={
                    list(obj(data.facets).collections).length
                      ? list(obj(data.facets).collections)
                      : collections
                  }
                  owner={owner}
                />
                {owner && (
                  <div className={s.stats}>
                    {[
                      {
                        label: "Matching orders",
                        value: str(obj(data.stats).orders),
                      },
                      {
                        label: "Whole order totals · AUD",
                        value: money(num(obj(data.stats).wholeOrderCents)),
                      },
                      {
                        label: "Matching item totals · AUD",
                        value: money(num(obj(data.stats).matchedItemCents)),
                      },
                      {
                        label: "Matching item discounts · AUD",
                        value: money(num(obj(data.stats).matchedDiscountCents)),
                      },
                    ].map((stat) => (
                      <div key={stat.label}>
                        {stat.label}
                        <strong>{stat.value}</strong>
                      </div>
                    ))}
                  </div>
                )}
                <Table
                  rows={rows}
                  columns={[
                    { key: "number", label: "Order" },
                    {
                      key: "createdAt",
                      label: "Created",
                      render: (r) => dateTime(r.createdAt),
                    },
                    { key: "paymentStatus", label: "Payment" },
                    { key: "fulfillmentStatus", label: "Fulfillment" },
                    { key: "itemCount", label: "Units" },
                    ...(owner
                      ? [
                          { key: "email", label: "Email" },
                          { key: "recipientName", label: "Recipient" },
                          {
                            key: "totalCents",
                            label: "Total AUD",
                            render: (r: Row) => money(num(r.totalCents)),
                          },
                        ]
                      : []),
                    { key: "carrier", label: "Carrier" },
                    { key: "trackingNumber", label: "Tracking" },
                    { key: "exception", label: "Exception" },
                  ]}
                  select={(r) => go(section, str(r.id))}
                />
                {owner && <ExportLink section="orders" query={query} />}
                <p className={s.muted}>
                  Whole-order totals include fixed shipping once per order.
                  Matching item totals include only matching snapshot lines.
                  Refunds and discount codes are not connected.
                </p>
              </>
            )}
            {section === "orders" && id && (
              <>
                <p>
                  <strong>
                    {str(data.paymentStatus)} / {str(data.fulfillmentStatus)}
                  </strong>{" "}
                  · Created {dateTime(data.createdAt)}
                </p>
                <p className={s.notice}>
                  Local order. Real payments and refunds are not connected.
                  Shipping is whole-order only.
                </p>
                {!!data.exception && (
                  <p className={s.error}>{str(data.exception)}</p>
                )}
                <div className={s.split}>
                  <div className={s.box}>
                    <h2>Delivery address</h2>
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
                    {owner && <p>{str(data.email)}</p>}
                  </div>
                  {owner && (
                    <div className={s.box}>
                      <h2>Amounts · AUD</h2>
                      <p>Items {money(num(data.subtotalCents))}</p>
                      <p>Fixed shipping {money(num(data.shippingCents))}</p>
                      <p>
                        <strong>Total {money(num(data.totalCents))}</strong>
                      </p>
                      <p>
                        Item discounts already included:{" "}
                        {money(num(data.discountCents))}
                      </p>
                      <p>No refund has been processed.</p>
                    </div>
                  )}
                </div>
                <Table
                  rows={orderLines}
                  columns={[
                    { key: "productName", label: "Purchased product" },
                    { key: "sku", label: "SKU" },
                    { key: "size", label: "Size" },
                    { key: "color", label: "Color" },
                    { key: "quantity", label: "Quantity" },
                    ...(owner
                      ? [
                          {
                            key: "unitPriceCents",
                            label: "Unit price AUD",
                            render: (r: Row) => money(num(r.unitPriceCents)),
                          },
                          {
                            key: "lineTotalCents",
                            label: "Line total AUD",
                            render: (r: Row) => money(num(r.lineTotalCents)),
                          },
                          { key: "categoryName", label: "Category snapshot" },
                          {
                            key: "collections",
                            label: "Collection snapshots",
                            render: (r: Row) =>
                              list(r.collections)
                                .map((c) => str(c.name))
                                .join(", "),
                          },
                          { key: "discountSource", label: "Discount source" },
                        ]
                      : []),
                  ]}
                />
                <div className={s.actions}>
                  {writer &&
                    data.paymentStatus === "PAID" &&
                    data.fulfillmentStatus === "UNFULFILLED" && (
                      <button
                        className={s.button}
                        onClick={() => setAction("ship")}
                      >
                        Confirm whole-order shipment
                      </button>
                    )}
                  {owner && data.fulfillmentStatus === "UNFULFILLED" && (
                    <button
                      className={s.secondary}
                      onClick={() => setAction("order-cancel")}
                    >
                      Cancel order
                    </button>
                  )}
                  {writer && data.fulfillmentStatus === "SHIPPED" && (
                    <button
                      className={s.secondary}
                      onClick={() => setAction("order-return")}
                    >
                      Register inspected return
                    </button>
                  )}
                  {owner &&
                    !!data.devPaymentsEnabled &&
                    ["PENDING", "EXPIRED", "FAILED"].includes(
                      str(data.paymentStatus),
                    ) && (
                      <button
                        className={s.secondary}
                        onClick={() => setAction("simulate")}
                      >
                        Simulate payment (DEV only)
                      </button>
                    )}
                </div>
                <div key={`${section}-${id}-${action}`}>{renderForm()}</div>
                <h2>Physical returns</h2>
                <Table
                  rows={list(data.returns)}
                  columns={[
                    { key: "lineId", label: "Item" },
                    { key: "sellable", label: "Sellable" },
                    { key: "unavailable", label: "Unavailable" },
                    { key: "reason", label: "Reason" },
                    {
                      key: "createdAt",
                      label: "When",
                      render: (r) => dateTime(r.createdAt),
                    },
                  ]}
                />
                <h2>Order timeline</h2>
                <Timeline rows={list(data.history)} />
              </>
            )}
            {section === "accounts" && (
              <>
                {selected && (
                  <button
                    className={s.secondary}
                    onClick={() => setAction("account-update")}
                  >
                    Edit selected permissions
                  </button>
                )}
                <div key={`${section}-${id}-${action}`}>{renderForm()}</div>
                <Table
                  rows={rows}
                  columns={[
                    { key: "name", label: "Name" },
                    { key: "email", label: "Email" },
                    {
                      key: "role",
                      label: "Permission",
                      render: (r) =>
                        roleLabels[str(r.role) as keyof typeof roleLabels] ||
                        str(r.role),
                    },
                    {
                      key: "active",
                      label: "Active",
                      render: (r) => (r.active ? "Yes" : "No"),
                    },
                  ]}
                  select={(r) => go("accounts", str(r.id))}
                />
                <p className={s.muted}>
                  Use one account per person. Permission changes and
                  deactivation revoke existing sessions. The last active owner
                  is protected. Password resets use the private local
                  administrator command.
                </p>
              </>
            )}
            {section === "history" && (
              <>
                <form
                  className={s.filters}
                  action="/admin/operations"
                  method="get"
                >
                  <input type="hidden" name="section" value="history" />
                  <label>
                    Action or reason
                    <input name="q" defaultValue={params.get("q") || ""} />
                  </label>
                  <label>
                    Object type
                    <input
                      name="objectType"
                      defaultValue={params.get("objectType") || ""}
                    />
                  </label>
                  <button className={s.button}>Filter history</button>
                </form>
                <p className={s.muted}>
                  Recorded changes cannot be edited or deleted through the
                  application. Corrections create another record.
                </p>
                <Table
                  rows={rows}
                  columns={[
                    {
                      key: "createdAt",
                      label: "When",
                      render: (r) => dateTime(r.createdAt),
                    },
                    { key: "actorName", label: "Operator" },
                    { key: "action", label: "Action" },
                    { key: "objectType", label: "Object" },
                    { key: "objectId", label: "Reference" },
                    { key: "reason", label: "Reason" },
                    {
                      key: "changes",
                      label: "Recorded before / after",
                      render: (r) => (
                        <details>
                          <summary>View changes</summary>
                          <pre>
                            {JSON.stringify(
                              { before: r.before, after: r.after },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      ),
                    },
                  ]}
                />
              </>
            )}
            {section === "settings" && (
              <>
                <p className={s.muted}>
                  Shipping is not assumed to be free. Checkout stays unavailable
                  until a fixed Australian shipping amount is explicitly
                  configured. Amounts use AUD cents: 1200 = A$12.00.
                </p>
                <MutationForm
                  key={str(data.updatedAt) || "settings"}
                  title="Checkout settings"
                  fields={[
                    {
                      name: "shippingConfigured",
                      label: "Fixed Australian shipping is configured",
                      type: "checkbox",
                    },
                    {
                      name: "shippingCents",
                      label: "Fixed shipping (AUD cents)",
                      type: "number",
                      min: 0,
                      max: 100000,
                    },
                    {
                      name: "reservationMinutes",
                      label: "Pending-payment reservation minutes",
                      type: "number",
                      min: 1,
                      max: 1440,
                      required: true,
                    },
                    reasonField,
                  ]}
                  initial={{
                    shippingConfigured: data.shippingCents !== null,
                    shippingCents: num(data.shippingCents),
                    reservationMinutes: num(data.reservationMinutes) || 30,
                    reason: "",
                  }}
                  submit={(v) => {
                    const { shippingConfigured, ...values } = v;
                    return ops("settings", {
                      ...values,
                      shippingCents: shippingConfigured
                        ? num(v.shippingCents)
                        : null,
                    });
                  }}
                  onSaved={saved}
                />
                <p className={s.notice}>
                  Development payment simulation is{" "}
                  {data.devPayments
                    ? "enabled in this local development process"
                    : "disabled"}
                  . It is always rejected in production. No real money is
                  charged.
                </p>
                <p>
                  Keep the reservation worker running in a separate project
                  terminal: <code>npm run orders:worker</code>. It releases
                  expired holds without a customer reopening the site.
                </p>
              </>
            )}
            {!id && ["inventory", "transfers", "orders"].includes(section) && (
              <div className={s.pager}>
                {num(data.page) > 1 && (
                  <Link
                    href={`/admin/operations?${new URLSearchParams({ ...Object.fromEntries(params), page: String(num(data.page) - 1) })}`}
                  >
                    ← Previous
                  </Link>
                )}
                <span>
                  Page {num(data.page) || 1} / {num(data.pageCount) || 1} ·{" "}
                  {num(data.total)} records
                </span>
                {num(data.page) < num(data.pageCount) && (
                  <Link
                    href={`/admin/operations?${new URLSearchParams({ ...Object.fromEntries(params), page: String(num(data.page) + 1) })}`}
                  >
                    Next →
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
function ExportLink({ section, query }: { section: string; query: string }) {
  const q = new URLSearchParams(query);
  q.set("format", "csv");
  q.delete("page");
  return (
    <a className={s.secondary} href={`/api/operations/${section}?${q}`}>
      Export filtered CSV
    </a>
  );
}
function Filters({
  section,
  params,
  categories,
  collections,
  owner,
}: {
  section: string;
  params: ReturnType<typeof useSearchParams>;
  categories: Row[];
  collections: Row[];
  owner: boolean;
}) {
  const common: Field[] = [
    {
      name: "q",
      label:
        section === "inventory"
          ? "Product / SKU"
          : section === "orders"
            ? owner
              ? "Order / email / name / tracking"
              : "Order / tracking"
            : "Transfer / tracking",
    },
  ];
  const productFields: Field[] = [
    { name: "sku", label: "SKU" },
    { name: "size", label: "Size" },
    { name: "color", label: "Color" },
    {
      name: "category",
      label: "Category",
      type: "select",
      options: [
        { value: "", label: "All categories" },
        ...categories.map((c) => ({ value: str(c.id), label: str(c.name) })),
      ],
    },
    {
      name: "collection",
      label: "Collection",
      type: "select",
      options: [
        { value: "", label: "All collections" },
        ...collections.map((c) => ({ value: str(c.id), label: str(c.name) })),
      ],
    },
  ];
  const select = (name: string, label: string, values: string[]): Field => ({
    name,
    label,
    type: "select",
    options: [
      { value: "", label: "All" },
      ...values.map((v) => ({ value: v, label: v })),
    ],
  });
  const inventory: Field[] = [
    ...productFields,
    select(
      "warehouse",
      "Warehouse",
      owner ? ["BEIJING", "MELBOURNE"] : ["MELBOURNE"],
    ),
    select("availability", "Stock state", [
      "IN_STOCK",
      "RESTOCKING_SOON",
      "RESTOCK_PLANNED",
      "OUT_OF_STOCK",
    ]),
    select("status", "Product state", ["DRAFT", "PUBLISHED", "ARCHIVED"]),
    { name: "etaFrom", label: "ETA from", type: "date" },
    { name: "etaTo", label: "ETA to", type: "date" },
    ...[
      ["low", "Low stock in selected warehouse"],
      ["active", "Enabled SKUs, excluding archived products"],
      ["zero", "Zero available in selected warehouse"],
      ["unavailable", "Has unavailable stock"],
      ["transit", "In transit"],
      ["overdue", "Overdue transit"],
      ["discrepancy", "Receipt / count discrepancy"],
      ["pendingCounts", "Pending stock count"],
      ...(owner ? [["legacy", "Legacy unassigned"]] : []),
    ].map(([name, label]) => ({ name, label, type: "checkbox" as const })),
    select("sort", "Sort", ["sku", "name", "available-asc", "transit-desc"]),
  ];
  const orders: Field[] = [
    { name: "product", label: "Purchased product" },
    ...productFields,
    select("payment", "Payment", [
      "PENDING",
      "PAID",
      "FAILED",
      "EXPIRED",
      "REVIEW",
    ]),
    select("fulfillment", "Fulfillment", [
      "UNFULFILLED",
      "SHIPPED",
      "CANCELLED",
    ]),
    select("timeField", "Date field (UTC)", [
      "createdAt",
      "paidAt",
      "shippedAt",
    ]),
    { name: "from", label: "Date from (UTC)", type: "date" },
    { name: "to", label: "Date to (UTC)", type: "date" },
    ...(owner
      ? [
          { name: "email", label: "Email" },
          {
            name: "minCents",
            label: "Min order total (AUD cents)",
            type: "number" as const,
            min: 0,
          },
          {
            name: "maxCents",
            label: "Max order total (AUD cents)",
            type: "number" as const,
            min: 0,
          },
        ]
      : []),
    select("state", "Australian state", [
      "ACT",
      "NSW",
      "NT",
      "QLD",
      "SA",
      "TAS",
      "VIC",
      "WA",
    ]),
    { name: "postcode", label: "Postcode" },
    { name: "carrier", label: "Carrier" },
    select("shippingMethod", "Delivery method", ["FIXED_AU"]),
    select("currency", "Currency", ["AUD"]),
    select("discountSource", "Snapshot discount source", ["MARKDOWN", "NONE"]),
    ...[
      ["deals", "Purchased discounted item"],
      ["cancelled", "Cancelled"],
      ["exceptions", "Payment / stock exception"],
      ["overdue", "Paid, unshipped over 48 hours"],
    ].map(([name, label]) => ({ name, label, type: "checkbox" as const })),
    select(
      "sort",
      "Sort",
      owner
        ? ["newest", "oldest", "total-asc", "total-desc"]
        : ["newest", "oldest"],
    ),
  ];
  const transfers: Field[] = [
    {
      name: "awaitingReceipt",
      label: "Awaiting receipt (remaining quantities)",
      type: "checkbox",
    },
    select("status", "Transfer state", [
      "DRAFT",
      "SENT",
      "PARTIAL",
      "CLOSED",
      "CANCELLED",
    ]),
    { name: "overdue", label: "Overdue", type: "checkbox" },
    {
      name: "discrepancy",
      label: "Exception / receipt discrepancy",
      type: "checkbox",
    },
  ];
  const fields = [
    ...common,
    ...(section === "inventory"
      ? inventory
      : section === "orders"
        ? orders
        : transfers),
  ];
  return (
    <form method="get" action="/admin/operations" className={s.filters}>
      <input type="hidden" name="section" value={section} />
      {fields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.type === "checkbox" ? (
            <input
              type="checkbox"
              name={f.name}
              value="true"
              defaultChecked={params.get(f.name) === "true"}
            />
          ) : f.type === "select" ? (
            <Select
              aria-label={f.label}
              name={f.name}
              defaultValue={params.get(f.name) || ""}
            >
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <input
              name={f.name}
              type={f.type || "text"}
              min={f.min}
              defaultValue={params.get(f.name) || ""}
            />
          )}
        </label>
      ))}
      <button className={s.button}>Search / filter</button>
      <Link
        className={s.secondary}
        href={`/admin/operations?section=${section}`}
      >
        Clear filters
      </Link>
    </form>
  );
}
