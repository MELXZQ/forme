"use client";
import { Select } from "@/components/ui/Select";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Table,
  Timeline,
  type Row,
  list,
  obj,
  str,
  num,
  dateTime,
} from "../operations/ui";
import {
  BusinessForm,
  Attachments,
  businessApi,
  pick,
  today,
  type Field,
} from "./forms";
import {
  f,
  select,
  currency,
  timezone,
  warehouse,
  people,
  category,
  supplier,
  supplierFields,
  purchaseFields,
  expenseFields,
  recurringFields,
  reference,
  occurred,
  rateFields,
  recordOptions,
} from "./fields";
import s from "../operations/Operations.module.css";
const href = (section: string, id?: unknown) =>
  "/admin/business?section=" +
  section +
  (id ? "&id=" + encodeURIComponent(str(id)) : "");
const money = (amount: unknown, currency: unknown) =>
  str(currency) + " " + (num(amount) / 100).toFixed(2);
function Notifications({ items }: { items: Row[] }) {
  return items.length ? (
    <section className={s.box}>
      <h2>Related notifications</h2>
      {items.map((n) => (
        <p key={str(n.id)}>
          <Link href={"/admin/notifications?id=" + n.id}>{str(n.title)}</Link> ·{" "}
          {str(n.status)} {n.pinned ? " · Pinned" : ""}
        </p>
      ))}
    </section>
  ) : null;
}
function Backfill({
  id,
  meta,
  onSaved,
}: {
  id: string;
  meta: Row;
  onSaved: () => void;
}) {
  const [preview, setPreview] = useState<Row | null>(null),
    [range, setRange] = useState({ from: today(), to: today() }),
    [message, setMessage] = useState("");
  return (
    <section className={s.box}>
      <h2>Backfill past periods</h2>
      <p>Preview up to 100 missing periods. These create obligations only.</p>
      <div className={s.grid}>
        {(["from", "to"] as const).map((k) => (
          <label key={k}>
            {k}
            <input
              type="date"
              value={range[k]}
              onChange={(e) => {
                setRange({ ...range, [k]: e.target.value });
                setPreview(null);
              }}
            />
          </label>
        ))}
      </div>
      <button
        className={s.secondary}
        onClick={async () => {
          try {
            setPreview(
              await businessApi(`recurring/${id}/backfill`, {
                ...range,
                key: crypto.randomUUID(),
                reason: "Preview historical billing periods",
                preview: true,
              }),
            );
            setMessage("");
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        Preview missing periods
      </button>
      {preview && (
        <>
          <p>
            {str(preview.count)} periods:{" "}
            {(preview.cycles as string[]).join(", ") || "None"}
          </p>
          <BusinessForm
            title="confirmed backfill"
            fields={[]}
            meta={meta}
            endpoint={`recurring/${id}/backfill`}
            extra={{ ...range, preview: false, expectedCount: preview.count }}
            onSaved={() => {
              setPreview(null);
              onSaved();
            }}
          />
        </>
      )}
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
function Receive({
  purchaseId,
  parcelId,
  meta,
  onSaved,
}: {
  purchaseId: string;
  parcelId?: string;
  meta: Row;
  onSaved: () => void;
}) {
  const [context, setContext] = useState<Row | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    businessApi(`purchases/${purchaseId}/receiving`)
      .then((v) => {
        if (live) setContext(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [purchaseId]);
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {context && (
        <>
          <p className={s.notice}>
            Actual warehouse acceptance for {str(context.number)}. Reuse the
            same acceptance reference across all entry points. Signing a parcel
            does not receive stock. Record damaged / inspection units as
            unavailable.
          </p>
          <BusinessForm
            title="warehouse acceptance"
            meta={meta}
            fields={[
              reference,
              occurred,
              f("notes", "Acceptance notes", "textarea"),
            ]}
            endpoint={`purchases/${purchaseId}/receive`}
            extra={{ parcelId: parcelId || null }}
            lineKind="receipt"
            lineRows={list(context.lines)}
            onSaved={() => onSaved()}
          />
        </>
      )}
    </>
  );
}
function ParcelCreate({
  meta,
  onSaved,
}: {
  meta: Row;
  onSaved: (r: Row) => void;
}) {
  const [type, setType] = useState("SUPPLIER_INBOUND"),
    [source, setSource] = useState(""),
    [context, setContext] = useState<Row | null>(null),
    [error, setError] = useState("");
  const collection = type.startsWith("SUPPLIER")
    ? "purchases"
    : type === "TRANSFER"
      ? "transfers"
      : type.startsWith("CUSTOMER")
        ? "orders"
        : "";
  useEffect(() => {
    let live = true;
    if (source && type.startsWith("SUPPLIER"))
      businessApi(`purchases/${source}/receiving`)
        .then((v) => {
          if (live) setContext(v);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [source, type]);
  const fields: Field[] = [
    people(meta),
    { ...warehouse, required: false },
    timezone,
    f("sourcePlace", "Source place", "text", true),
    f("destinationPlace", "Destination place", "text", true),
    f("sender", "Sender details", "textarea", true),
    f("recipient", "Recipient details", "textarea", true),
    f("carrier", "Carrier"),
    f("trackingNumber", "Tracking number"),
    f("packageCount", "Package count", "number", true),
    f("weightGrams", "Weight in grams (optional)", "number"),
    f("etaStart", "Expected arrival from", "date"),
    f("etaEnd", "Expected arrival by", "date"),
    f("notes", "Notes", "textarea"),
    f(
      "trackingReuseReason",
      "Reason if legitimately reusing a tracking number",
    ),
  ];
  if (type === "SUPPLIER_RETURN")
    fields.push({
      ...f("returnId", "Recorded supplier return", "select", true),
      options: recordOptions(list(context?.returns), "reference"),
    });
  if (type === "CUSTOMER_RETURN")
    fields.push({
      ...f("returnId", "Recorded customer return", "select", true),
      options: recordOptions(
        list(meta.returns).filter((r) => r.orderId === source),
        "label",
      ),
    });
  return (
    <section className={s.box}>
      <h2>New parcel</h2>
      <div className={s.grid}>
        <label>
          Transport type
          <Select
            aria-label="Transport type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setSource("");
              setContext(null);
            }}
          >
            {[
              "SUPPLIER_INBOUND",
              "TRANSFER",
              "CUSTOMER_DELIVERY",
              "CUSTOMER_RETURN",
              "SUPPLIER_RETURN",
              "OTHER",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </label>
        {collection && (
          <label>
            Source business record
            <Select
              aria-label="Source business record"
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setContext(null);
              }}
            >
              <option value="">Choose source</option>
              {list(meta[collection]).map((r) => (
                <option key={str(r.id)} value={str(r.id)}>
                  {str(r.number)}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {(!collection ||
        (source && (!type.startsWith("SUPPLIER") || context))) && (
        <BusinessForm
          key={type + source}
          title="parcel"
          endpoint="logistics"
          fields={fields}
          meta={{ ...meta, purchaseLines: context?.lines }}
          initial={{
            assigneeId: obj(meta.actor).id,
            warehouse: context?.warehouse || "MELBOURNE",
            timezone:
              context?.warehouse === "BEIJING"
                ? "Asia/Shanghai"
                : "Australia/Melbourne",
            packageCount: 1,
          }}
          extra={{
            type,
            purchaseId: collection === "purchases" ? source : null,
            transferId: collection === "transfers" ? source : null,
            orderId: collection === "orders" ? source : null,
          }}
          lineKind="parcel"
          onSaved={onSaved}
        />
      )}
    </section>
  );
}
export function BusinessApp() {
  const router = useRouter(),
    params = useSearchParams(),
    section = params.get("section") || "purchases",
    id = params.get("id"),
    isNew = params.get("new") === "1";
  const [meta, setMeta] = useState<Row>({}),
    [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [savedNotice, setSavedNotice] = useState({ query: "", message: "" }),
    [revision, setRevision] = useState(0),
    [action, setAction] = useState("");
  const query = params.toString();
  const notice = savedNotice.query === query ? savedNotice.message : "";
  const setNotice = (message: string, target = query) =>
    setSavedNotice({ message, query: target });

  useEffect(() => {
    let live = true;
    businessApi("meta")
      .then((v) => {
        if (live) setMeta(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [revision]);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (live) {
        setData(null);
        setError("");
        setAction("");
      }
    });
    if (isNew) return;
    const q = new URLSearchParams(query);
    q.delete("section");
    q.delete("id");
    businessApi(section + (id ? "/" + encodeURIComponent(id) : "?" + q))
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [section, id, isNew, query, revision]);
  const caps = (meta.capabilities || []) as string[];
  const refresh = () => {
    setNotice("Saved successfully.");
    setRevision((n) => n + 1);
  };
  const saved = (r: Row) => {
    if (isNew && r.id) router.push(href(section, r.id));
    refresh();
    if (isNew && r.id)
      setNotice(
        "Saved successfully.",
        new URLSearchParams({ section, id: str(r.id) }).toString(),
      );
  };
  const baseInitial = {
    assigneeId: obj(meta.actor).id,
    currency: "AUD",
    timezone: "Australia/Melbourne",
    amount: 0,
    discount: 0,
    domesticShipping: 0,
    otherFees: 0,
    tolerance: 0,
    graceDays: 0,
    reminderDays: 7,
    plannedAt: today(),
    dueAt: today(),
    resultDueAt: today(),
    paymentMode: "MANUAL",
    anchorDate: today(),
    interval: 1,
    unit: "MONTH",
    status: "ACTIVE",
    warehouse: "BEIJING",
  };
  const form = (
    title: string,
    fields: Field[],
    endpoint: string,
    extra: Row = {},
    initial: Row = data || {},
    lineKind?: "purchase" | "receipt",
    lineRows?: Row[],
  ) => (
    <BusinessForm
      key={section + id + action + revision + title}
      title={title}
      fields={fields}
      endpoint={endpoint}
      extra={extra}
      initial={initial}
      meta={meta}
      onSaved={saved}
      lineKind={lineKind}
      lineRows={lineRows}
    />
  );
  const go = (r: Row) => {
    if (section === "logistics" && r.source !== "PARCEL")
      router.push(
        "/admin/operations?section=" +
          (r.source === "TRANSFER" ? "transfers" : "orders") +
          "&id=" +
          encodeURIComponent(str(r.reference)),
      );
    else router.push(href(section, r.id));
  };
  const filters: Field[] = [
    f("q", "Search name / number / SKU"),
    select(
      "status",
      "State",
      section === "expenses"
        ? ["OPEN", "CANCELLED"]
        : section === "purchases"
          ? ["DRAFT", "CONFIRMED", "CLOSED", "CANCELLED"]
          : section === "suppliers"
            ? ["ACTIVE", "ARCHIVED"]
            : [
                "PREPARING",
                "DISPATCHED",
                "IN_TRANSIT",
                "SIGNED",
                "EXCEPTION",
                "LOST",
                "RETURNED",
              ],
      false,
    ),
  ];
  if (["expenses", "purchases"].includes(section))
    filters.push(
      { ...supplier(meta, false), name: "supplier" },
      { ...people(meta), name: "assignee", required: false },
      { ...currency, required: false },
      select(
        "payment",
        "Payment state",
        ["UNPAID", "PART_PAID", "PAID", "REFUND_RECORDED", "UNVERIFIED"],
        false,
      ),
    );
  if (section === "expenses")
    filters.push(
      select("dataKind", "Record scope", ["REAL", "TEST"], false),
      f("pending", "Open with outstanding balance", "checkbox"),
      f("exception", "Unresolved expense alerts", "checkbox"),
      { ...category(meta), name: "category", required: false },
      select("result", "Outcome", ["PENDING", "CONFIRMED"], false),
      select("dateField", "Date basis", ["created", "due", "paid"], false),
      f("from", "From", "date"),
      f("to", "Through", "date"),
      select(
        "linkedType",
        "Linked business",
        ["purchase", "parcel", "transfer", "order", "subscription"],
        false,
      ),
      {
        ...f("linkedId", "Linked record", "select"),
        options: [
          ...recordOptions(list(meta.purchases)),
          ...recordOptions(list(meta.parcels)),
          ...recordOptions(list(meta.transfers)),
          ...recordOptions(list(meta.orders)),
          ...recordOptions(list(meta.recurring), "name"),
        ],
      },
      f("min", "Minimum amount (minor units)", "number"),
      f("max", "Maximum amount (minor units)", "number"),
      select("sort", "Sort", ["newest", "oldest", "amount-desc"], false),
      ...["overdue", "failed", "missingEvidence", "unfinished"].map((k) =>
        f(
          k,
          {
            overdue: "Overdue only",
            failed: "Confirmed payment failures",
            missingEvidence: "Missing attachment",
            unfinished: "Outcome not confirmed",
          }[k] || k,
          "checkbox",
        ),
      ),
    );
  if (section === "logistics")
    filters.push(
      select(
        "source",
        "Record unit",
        ["PARCEL", "TRANSFER", "ORDER", "RETURN"],
        false,
      ),
      select("dataKind", "Record scope", ["REAL", "TEST"], false),
      f("inTransit", "Dispatched / in transit", "checkbox"),
      f("awaitingArrival", "Arrival not completed", "checkbox"),
      select(
        "type",
        "Type",
        [
          "SUPPLIER_INBOUND",
          "TRANSFER",
          "CUSTOMER_DELIVERY",
          "CUSTOMER_RETURN",
          "REPLACEMENT",
          "SUPPLIER_RETURN",
          "OTHER",
        ],
        false,
      ),
      { ...warehouse, required: false },
      {
        ...warehouse,
        name: "sourceWarehouse",
        label: "Source warehouse",
        required: false,
      },
      f("carrier", "Carrier"),
      { ...people(meta), name: "assignee", required: false },
      select(
        "dateField",
        "Date basis",
        ["created", "dispatched", "eta", "signed", "received"],
        false,
      ),
      f("from", "From", "date"),
      f("to", "Through", "date"),
      select(
        "acceptance",
        "Acceptance state",
        [
          "NOT_RECEIVED",
          "PART_RECEIVED",
          "RECEIVED",
          "ACCOUNTED_FOR",
          "SEE_LINKED_RECORD",
        ],
        false,
      ),
      f("overdue", "Overdue only", "checkbox"),
      f("discrepancy", "Recorded differences", "checkbox"),
    );
  return (
    <div className={s.root}>
      <main id="main" className={s.content}>
        <div className={s.heading}>
          <h1>{section[0].toUpperCase() + section.slice(1)}</h1>
          {id || isNew ? (
            <Link href={href(section)}>Back to list</Link>
          ) : (
            section !== "grants" && (
              <Link className={s.button} href={href(section) + "&new=1"}>
                New{" "}
                {section === "recurring"
                  ? "recurring rule"
                  : section === "logistics"
                    ? "parcel"
                    : section.slice(0, -1)}
              </Link>
            )
          )}
        </div>
        <p className={s.titleNote}>
          Local management · Recorded obligations, cash, transport and warehouse
          acceptance remain separate. No payment or carrier provider is
          connected.
        </p>
        {notice && !isNew && (
          <p role="status" className={s.notice}>
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
        {isNew &&
          !!meta.actor &&
          (section === "suppliers" ? (
            form("supplier", supplierFields, "suppliers", {}, baseInitial)
          ) : section === "purchases" ? (
            form(
              "purchase draft",
              purchaseFields(meta),
              "purchases",
              {},
              baseInitial,
              "purchase",
            )
          ) : section === "expenses" ? (
            form(
              "independent expense",
              expenseFields(meta),
              "expenses",
              {},
              baseInitial,
            )
          ) : section === "recurring" ? (
            form(
              "recurring rule",
              recurringFields(meta),
              "recurring",
              {},
              baseInitial,
            )
          ) : section === "logistics" ? (
            <ParcelCreate meta={meta} onSaved={saved} />
          ) : null)}
        {!isNew && !id && section !== "grants" && section !== "recurring" && (
          <form
            key={query}
            className={s.filters}
            onSubmit={(e) => {
              e.preventDefault();
              const q = new URLSearchParams({ section });
              new FormData(e.currentTarget).forEach((v, k) => {
                if (v) q.set(k, str(v));
              });
              router.push("/admin/business?" + q);
            }}
          >
            {filters.map((field) => (
              <label key={field.name}>
                {field.label}
                {field.type === "select" ? (
                  <Select
                    aria-label={field.label}
                    name={field.name}
                    defaultValue={params.get(field.name) || ""}
                  >
                    <option value="">All / default</option>
                    {field.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : field.type === "checkbox" ? (
                  <input
                    name={field.name}
                    type="checkbox"
                    value="true"
                    defaultChecked={params.get(field.name) === "true"}
                  />
                ) : (
                  <input
                    name={field.name}
                    type={field.type || "text"}
                    defaultValue={params.get(field.name) || ""}
                  />
                )}
              </label>
            ))}
            <button className={s.button}>Apply filters</button>
            <Link href={href(section)}>Clear</Link>
          </form>
        )}
        {!isNew && !data && !error && (
          <p role="status">Loading business records…</p>
        )}
        {!id && data && (
          <>
            {section === "expenses" && (
              <section className={s.box}>
                <h2>Expense / cash-flow summary</h2>
                <p>
                  Original currencies are separate. Cash uses actual event
                  dates, TEST records are excluded. Report currency: AUD.
                  Missing rates remain unknown.
                </p>
                <Table
                  rows={Object.entries(obj(data.summary)).map(
                    ([currency, v]) => ({ currency, ...obj(v) }),
                  )}
                  columns={[
                    { key: "currency", label: "Currency" },
                    ...[
                      "obligation",
                      "paid",
                      "refund",
                      "net",
                      "outstanding",
                    ].map((k) => ({
                      key: k,
                      label:
                        {
                          obligation: "Obligations",
                          paid: "Actual paid",
                          refund: "Refund received",
                          net: "Net cash out",
                          outstanding: "Still payable",
                        }[k] || k,
                      render: (r: Row) => money(r[k], r.currency),
                    })),
                    {
                      key: "reportObligation",
                      label: "Known AUD obligations",
                      render: (r) => money(r.reportObligation, "AUD"),
                    },
                    {
                      key: "reportNet",
                      label: "Known AUD net cash",
                      render: (r) => money(r.reportNet, "AUD"),
                    },
                    { key: "missingRates", label: "Missing FX records" },
                  ]}
                />
              </section>
            )}
            {["expenses", "logistics"].includes(section) && (
              <a
                className={s.secondary}
                href={
                  "/api/business/" +
                  section +
                  "?" +
                  new URLSearchParams(
                    [...params.entries()].filter(
                      ([k]) => !["section", "id"].includes(k),
                    ),
                  ) +
                  "&format=csv"
                }
              >
                Export filtered CSV
              </a>
            )}
            <Table
              rows={list(data.items)}
              columns={
                section === "suppliers"
                  ? [
                      { key: "code", label: "Code" },
                      { key: "name", label: "Supplier" },
                      { key: "contact", label: "Contact" },
                      { key: "currency", label: "Default currency" },
                      { key: "archived", label: "Archived" },
                    ]
                  : section === "purchases"
                    ? [
                        { key: "number", label: "Purchase" },
                        { key: "supplierSnapshot.name", label: "Supplier" },
                        { key: "warehouse", label: "Destination" },
                        { key: "status", label: "Purchase state" },
                        { key: "paymentStatus", label: "Payment state" },
                        { key: "receiptStatus", label: "Acceptance state" },
                        { key: "remaining", label: "Remaining units" },
                        {
                          key: "total",
                          label: "Total",
                          render: (r) => money(r.total, r.currency),
                        },
                      ]
                    : section === "expenses"
                      ? [
                          { key: "number", label: "Expense" },
                          { key: "title", label: "Name" },
                          {
                            key: "dueAt",
                            label: "Due",
                            render: (r) => str(r.dueAt).slice(0, 10),
                          },
                          {
                            key: "amount",
                            label: "Obligation",
                            render: (r) => money(r.amount, r.currency),
                          },
                          { key: "paymentStatus", label: "Payment state" },
                          { key: "resultStatus", label: "Outcome" },
                          { key: "status", label: "State" },
                        ]
                      : section === "recurring"
                        ? [
                            { key: "name", label: "Rule" },
                            { key: "nextDue", label: "Next due" },
                            { key: "status", label: "State" },
                            { key: "paymentMode", label: "Payment mode" },
                            {
                              key: "amount",
                              label: "Expected amount",
                              render: (r) => money(r.amount, r.currency),
                            },
                          ]
                        : section === "grants"
                          ? [
                              {
                                key: "userId",
                                label: "Staff member",
                                render: (r) =>
                                  str(
                                    list(data.people).find(
                                      (u) => u.id === r.userId,
                                    )?.name,
                                  ),
                              },
                              {
                                key: "capability",
                                label: "Granted capability",
                              },
                            ]
                          : [
                              { key: "number", label: "Record" },
                              { key: "type", label: "Type" },
                              { key: "source", label: "Source" },
                              {
                                key: "businessNumber",
                                label: "Related record",
                              },
                              { key: "trackingNumber", label: "Tracking" },
                              { key: "transportStatus", label: "Transport" },
                              { key: "acceptanceStatus", label: "Acceptance" },
                              { key: "total", label: "Units" },
                              { key: "received", label: "Accepted units" },
                            ]
              }
              select={section === "grants" ? undefined : go}
            />
            {data.pageCount && (
              <div className={s.pager}>
                <button
                  disabled={num(data.page) <= 1}
                  onClick={() => {
                    const q = new URLSearchParams(query);
                    q.set("page", str(num(data.page) - 1));
                    router.push("/admin/business?" + q);
                  }}
                >
                  Previous
                </button>
                <span>
                  {str(data.page)} / {str(data.pageCount)} · {str(data.total)}{" "}
                  records
                </span>
                <button
                  disabled={num(data.page) >= num(data.pageCount)}
                  onClick={() => {
                    const q = new URLSearchParams(query);
                    q.set("page", str(num(data.page) + 1));
                    router.push("/admin/business?" + q);
                  }}
                >
                  Next
                </button>
              </div>
            )}
            {section === "grants" &&
              form(
                "business permission",
                [
                  {
                    ...f("userId", "Warehouse staff", "select", true),
                    options: pick(
                      list(data.people).filter((u) => u.role === "warehouse"),
                    ),
                  },
                  select("capability", "Capability", [
                    "procurement",
                    "finance",
                    "recurring",
                    "logistics",
                  ]),
                  f("enabled", "Granted", "checkbox"),
                ],
                "grants",
              )}
            {section === "expenses" && (
              <details>
                <summary>Manage expense categories</summary>
                <Table
                  rows={list(meta.categories)}
                  columns={[
                    { key: "id", label: "Code" },
                    { key: "name", label: "Name" },
                    { key: "active", label: "Enabled" },
                  ]}
                />
                {form(
                  "expense category",
                  [
                    f("id", "Category code (reuse to update)", "text", true),
                    f("name", "Display name", "text", true),
                    f("active", "Enabled", "checkbox"),
                  ],
                  "categories",
                  {},
                  { active: true },
                )}
              </details>
            )}
          </>
        )}
        {id && data && (
          <>
            <section className={s.box}>
              <h2>{str(data.number || data.name || data.title)}</h2>
              <div className={s.stats}>
                {[
                  "status",
                  "warehouse",
                  "currency",
                  "paymentMode",
                  "transportStatus",
                  "resultStatus",
                ]
                  .filter((k) => data[k])
                  .map((k) => (
                    <div key={k}>
                      {k}
                      <strong>{str(data[k])}</strong>
                    </div>
                  ))}
                {data.total !== undefined && (
                  <div>
                    Purchase total
                    <strong>{money(data.total, data.currency)}</strong>
                  </div>
                )}
                {data.amount !== undefined && (
                  <div>
                    Obligation
                    <strong>{money(data.amount, data.currency)}</strong>
                  </div>
                )}
                {data.paid !== undefined && (
                  <>
                    <div>
                      Actual paid
                      <strong>{money(data.paid, data.currency)}</strong>
                    </div>
                    <div>
                      Refund received
                      <strong>{money(data.refund, data.currency)}</strong>
                    </div>
                  </>
                )}
              </div>
              <p>{str(data.notes)}</p>
              <div className={s.actions}>
                {(section === "suppliers"
                  ? ["edit", "source"]
                  : section === "purchases"
                    ? [
                        "edit",
                        "confirm",
                        "receive",
                        "close-line",
                        "return",
                        "finish",
                      ]
                    : section === "expenses"
                      ? ["edit", "cash", "result", "cancel", "refund", "link"]
                      : section === "recurring"
                        ? ["edit"]
                        : ["event", ...(data.receiving ? ["receive"] : [])]
                ).map((x) => (
                  <button
                    className={s.secondary}
                    key={x}
                    onClick={() => setAction(action === x ? "" : x)}
                  >
                    {{
                      edit: "Edit / revise",
                      source: "Add SKU source",
                      confirm: "Confirm purchase",
                      receive: "Warehouse acceptance",
                      "close-line": "Close remainder / shortage",
                      return: "Dispatch supplier return",
                      finish: "Close / cancel purchase",
                      cash: "Record payment / refund / reversal",
                      result: "Confirm service outcome",
                      cancel: "Cancel obligation",
                      refund: "Set refund expectation",
                      link: "Link existing fee",
                      event: "Record transport event",
                    }[x] || x}
                  </button>
                ))}
              </div>
            </section>
            {section === "suppliers" && (
              <>
                <Table
                  rows={list(data.sources)}
                  columns={[
                    {
                      key: "variantId",
                      label: "Internal SKU",
                      render: (r) =>
                        str(
                          list(meta.skus).find((s) => s.id === r.variantId)
                            ?.sku,
                        ),
                    },
                    { key: "supplierCode", label: "Supplier code" },
                    {
                      key: "url",
                      label: "Purchase link",
                      render: (r) =>
                        r.url ? (
                          <a href={str(r.url)} target="_blank" rel="noreferrer">
                            Open source
                          </a>
                        ) : (
                          "—"
                        ),
                    },
                    { key: "notes", label: "Notes" },
                  ]}
                />
                <Table
                  rows={list(data.purchases)}
                  columns={[
                    { key: "number", label: "Purchase" },
                    { key: "status", label: "State" },
                  ]}
                  select={(r) => router.push(href("purchases", r.id))}
                />
                {action === "edit" &&
                  form("supplier", supplierFields, "suppliers", { id })}
                {action === "source" &&
                  form(
                    "SKU source",
                    [
                      {
                        ...f("variantId", "Internal SKU", "select", true),
                        options: pick(list(meta.skus), "sku"),
                      },
                      f("supplierCode", "Supplier item code", "text", true),
                      f("url", "Purchase URL"),
                      f("notes", "Notes", "textarea"),
                    ],
                    "sources",
                    { supplierId: id },
                    {},
                  )}
              </>
            )}
            {section === "purchases" && (
              <>
                <p>
                  Supplier snapshot: {str(obj(data.supplierSnapshot).name)} ·
                  Ordered {dateTime(data.orderedAt)} · ETA{" "}
                  {str(data.etaStart).slice(0, 10)} –{" "}
                  {str(data.etaEnd).slice(0, 10)}
                </p>
                <p>
                  Included shipping{" "}
                  {money(data.domesticShipping, data.currency)} · Other fees{" "}
                  {money(data.otherFees, data.currency)} · Discount{" "}
                  {money(data.discount, data.currency)}. These amounts belong to
                  the purchase obligation.
                </p>
                {data.expense && (
                  <p>
                    <Link href={href("expenses", obj(data.expense).id)}>
                      Linked expense {str(obj(data.expense).number)}
                    </Link>{" "}
                    · Paid {money(obj(data.cash).paid, data.currency)} · Refund{" "}
                    {money(obj(data.cash).refund, data.currency)}
                  </p>
                )}
                <Table
                  rows={list(data.lines)}
                  columns={[
                    { key: "snapshot.sku", label: "SKU" },
                    { key: "snapshot.name", label: "Frozen product name" },
                    { key: "quantity", label: "Agreed" },
                    {
                      key: "unitCost",
                      label: "Unit cost",
                      render: (r) => money(r.unitCost, data.currency),
                    },
                    {
                      key: "replacementQty",
                      label: "Extra replacement commitment",
                    },
                    { key: "receivedSellable", label: "Accepted sellable" },
                    {
                      key: "receivedUnavailable",
                      label: "Accepted unavailable",
                    },
                    { key: "returnedQty", label: "Returned" },
                    { key: "cancelledQty", label: "Cancelled" },
                    { key: "shortClosedQty", label: "Closed shortage" },
                    { key: "remaining", label: "Remaining commitment" },
                  ]}
                />
                {action === "edit" &&
                  form(
                    "purchase revision",
                    purchaseFields(meta),
                    "purchases",
                    { id, version: data.version },
                    data,
                    "purchase",
                    list(data.lines),
                  )}
                {action === "confirm" &&
                  form("purchase confirmation", [], `purchases/${id}/confirm`, {
                    version: data.version,
                  })}
                {action === "receive" && (
                  <Receive purchaseId={id} meta={meta} onSaved={refresh} />
                )}{" "}
                {action === "close-line" &&
                  form(
                    "unfulfilled quantity",
                    [
                      {
                        ...f("lineId", "Purchase line", "select", true),
                        options: list(data.lines).map((l) => ({
                          value: str(l.id),
                          label:
                            str(obj(l.snapshot).sku) +
                            " · remaining " +
                            str(l.remaining),
                        })),
                      },
                      f("quantity", "Quantity to close", "number", true),
                      select("kind", "Treatment", ["CANCEL", "SHORTAGE"]),
                      f(
                        "acknowledgePayments",
                        "I reviewed cash history; cancellation revises the obligation",
                        "checkbox",
                      ),
                    ],
                    `purchases/${id}/close-line`,
                    {},
                    { quantity: 1, kind: "SHORTAGE" },
                  )}
                {action === "return" &&
                  form(
                    "supplier return",
                    [
                      reference,
                      occurred,
                      select(
                        "disposition",
                        "Agreed supplier obligation after return",
                        ["REFUND", "REPLACEMENT", "NO_FURTHER_OBLIGATION"],
                      ),
                      f(
                        "refundDueAt",
                        "Agreed refund deadline (refund only)",
                        "date",
                      ),
                    ],
                    `purchases/${id}/return`,
                    {},
                    { disposition: "REFUND" },
                    "receipt",
                    list(data.lines).map((l) => ({
                      ...l,
                      sellable: 0,
                      unavailable: 0,
                    })),
                  )}
                {action === "finish" &&
                  form(
                    "purchase closure",
                    [
                      select("status", "Final purchase state", [
                        "CLOSED",
                        "CANCELLED",
                      ]),
                    ],
                    `purchases/${id}/finish`,
                    { version: data.version },
                    { status: "CLOSED" },
                  )}
                <h2>Acceptance history</h2>
                <Table
                  rows={list(data.receipts)}
                  columns={[
                    { key: "reference", label: "Acceptance reference" },
                    {
                      key: "occurredAt",
                      label: "Actual acceptance",
                      render: (r) => dateTime(r.occurredAt),
                    },
                    {
                      key: "createdAt",
                      label: "Recorded",
                      render: (r) => dateTime(r.createdAt),
                    },
                    { key: "reason", label: "Evidence / reason" },
                    {
                      key: "lines",
                      label: "Accepted quantities",
                      render: (r) =>
                        list(r.lines)
                          .map(
                            (l) =>
                              `${str(obj(list(data.lines).find((x) => x.id === l.lineId)?.snapshot).sku)}: ${l.sellable} sellable / ${l.unavailable} unavailable`,
                          )
                          .join("; "),
                    },
                  ]}
                />
                <h2>Supplier returns</h2>
                <Table
                  rows={list(data.returns)}
                  columns={[
                    { key: "reference", label: "Reference" },
                    { key: "disposition", label: "Supplier obligation" },
                    {
                      key: "occurredAt",
                      label: "Dispatched",
                      render: (r) => dateTime(r.occurredAt),
                    },
                    { key: "reason", label: "Reason" },
                  ]}
                />
                <h2>Parcels</h2>
                <Table
                  rows={list(data.parcels)}
                  columns={[
                    { key: "number", label: "Parcel" },
                    { key: "transportStatus", label: "Transport" },
                    { key: "trackingNumber", label: "Tracking" },
                  ]}
                  select={(r) => router.push(href("logistics", r.id))}
                />
              </>
            )}
            {section === "expenses" && (
              <>
                <p>{str(data.purpose)}</p>
                <p>
                  Payee: {str(data.payee)} · Due {str(data.dueAt).slice(0, 10)}{" "}
                  · {str(data.timezone)} · Account alias{" "}
                  {str(data.accountAlias) || "—"} / {str(data.channel) || "—"}
                </p>
                <p>
                  Expected outcome: {str(data.expectedResult)} · due{" "}
                  {str(data.resultDueAt).slice(0, 10)} · Verify by{" "}
                  {str(data.verificationMethod)}. Evidence:{" "}
                  {str(data.resultEvidence) || "Not yet confirmed"}
                </p>
                {!!data.purchaseId && (
                  <p>
                    <Link href={href("purchases", data.purchaseId)}>
                      Original purchase — revise the total and acceptance there
                    </Link>
                  </p>
                )}
                {data.recurringId && (
                  <p>
                    <Link href={href("recurring", data.recurringId)}>
                      Recurring rule
                    </Link>{" "}
                    · Period {str(data.cycle)}
                  </p>
                )}
                <p>
                  Report amount:{" "}
                  {data.reportAmount === null
                    ? "Unknown — exchange rate missing"
                    : money(data.reportAmount, "AUD")}
                  . Rate source {str(data.rateSource) || "—"} /{" "}
                  {str(data.rateDate).slice(0, 10) || "—"}
                </p>
                {action === "edit" &&
                  !data.purchaseId &&
                  form("expense revision", expenseFields(meta), "expenses", {
                    id,
                    version: data.version,
                  })}
                {action === "edit" && !!data.purchaseId && (
                  <p className={s.notice}>
                    Revise the linked purchase; its total is the single source
                    for this obligation.
                  </p>
                )}
                {action === "cash" &&
                  form(
                    "actual cash record",
                    [
                      select("kind", "Record type", [
                        "PAYMENT",
                        "REFUND",
                        "REVERSAL",
                      ]),
                      select("status", "Known result", ["CONFIRMED", "FAILED"]),
                      f("amount", "Actual amount", "amount", true),
                      currency,
                      occurred,
                      select("source", "Record source", ["MANUAL", "TEST"]),
                      f(
                        "accountAlias",
                        "Account alias (no bank credentials)",
                        "text",
                        true,
                      ),
                      f("channel", "Payment channel", "text", true),
                      reference,
                      {
                        ...f(
                          "correctionOf",
                          "Original record to reverse",
                          "select",
                        ),
                        options: list(data.cash)
                          .filter(
                            (c) =>
                              c.kind !== "REVERSAL" &&
                              !list(data.cash).some(
                                (r) => r.correctionOf === c.id,
                              ),
                          )
                          .map((c) => ({
                            value: str(c.id),
                            label:
                              str(c.reference) +
                              " · " +
                              str(c.kind) +
                              " · " +
                              money(c.amount, c.currency),
                          })),
                      },
                      ...rateFields,
                    ],
                    `expenses/${id}/cash`,
                    {},
                    {
                      currency: data.currency,
                      amount: Math.max(0, num(data.amount) - num(data.paid)),
                      kind: "PAYMENT",
                      status: "CONFIRMED",
                      source: "MANUAL",
                      accountAlias: data.accountAlias,
                      channel: data.channel,
                      rateMicros: data.rateMicros,
                      rateDate: data.rateDate,
                      rateSource: data.rateSource,
                    },
                  )}
                {action === "result" &&
                  form(
                    "service outcome",
                    [
                      f(
                        "evidence",
                        "Evidence of actual service activation / delivery",
                        "textarea",
                        true,
                      ),
                    ],
                    `expenses/${id}/action`,
                    { version: data.version, action: "RESULT" },
                    {},
                  )}
                {action === "cancel" &&
                  form(
                    "obligation cancellation",
                    [],
                    `expenses/${id}/action`,
                    { version: data.version, action: "CANCEL" },
                    {},
                  )}
                {action === "refund" &&
                  form(
                    "refund expectation",
                    [
                      f(
                        "expectedRefund",
                        "Expected total refund",
                        "amount",
                        true,
                      ),
                      f("refundDueAt", "Refund due date", "date", true),
                    ],
                    `expenses/${id}/action`,
                    { version: data.version, action: "REFUND_EXPECTED" },
                    data,
                  )}
                {action === "link" && (
                  <FeeLink expense={data} meta={meta} onSaved={refresh} />
                )}
                <h2>Actual cash history</h2>
                <p>
                  Append-only records. To correct a mistake, record one reversal
                  and then the correct entry; TEST records are excluded from
                  real totals.
                </p>
                <Table
                  rows={list(data.cash)}
                  columns={[
                    { key: "reference", label: "Reference" },
                    { key: "kind", label: "Type" },
                    { key: "status", label: "Result" },
                    { key: "source", label: "Source" },
                    {
                      key: "amount",
                      label: "Amount",
                      render: (r) => money(r.amount, r.currency),
                    },
                    {
                      key: "occurredAt",
                      label: "Actual event",
                      render: (r) => dateTime(r.occurredAt),
                    },
                    {
                      key: "createdAt",
                      label: "Entered",
                      render: (r) => dateTime(r.createdAt),
                    },
                    { key: "reason", label: "Evidence" },
                    { key: "correctionOf", label: "Reverses original" },
                  ]}
                />
                <h2>Referenced business records</h2>
                <Table
                  rows={list(data.links)}
                  columns={[
                    { key: "objectType", label: "Type" },
                    { key: "objectId", label: "Record" },
                    { key: "meaning", label: "Fee treatment" },
                  ]}
                />
              </>
            )}
            {section === "recurring" && (
              <>
                <p>
                  Every {str(data.interval)} {str(data.unit)}, anchored{" "}
                  {str(data.anchorDate).slice(0, 10)} in {str(data.timezone)}.
                  Generated periods retain their own snapshots. Automatic
                  provider charging remains unverified until an actual record is
                  entered.
                </p>
                {action === "edit" &&
                  form("recurring rule", recurringFields(meta), "recurring", {
                    id,
                    version: data.version,
                  })}
                <h2>Generated periods</h2>
                <Table
                  rows={list(data.expenses)}
                  columns={[
                    { key: "cycle", label: "Period" },
                    { key: "number", label: "Expense" },
                    {
                      key: "amount",
                      label: "Expected amount",
                      render: (r) => money(r.amount, r.currency),
                    },
                    { key: "status", label: "State" },
                  ]}
                  select={(r) => router.push(href("expenses", r.id))}
                />
                <Backfill id={id} meta={meta} onSaved={refresh} />
              </>
            )}
            {section === "logistics" && (
              <>
                <p>
                  {str(data.sourcePlace)} → {str(data.destinationPlace)} ·{" "}
                  {str(data.carrier)} /{" "}
                  {str(data.trackingNumber) || "No tracking recorded"}
                </p>
                <p>
                  Sender: {str(data.sender)} · Recipient: {str(data.recipient)}{" "}
                  · {str(data.packageCount)} packages ·{" "}
                  {str(data.weightGrams) || "Unknown"} g
                </p>
                <p>
                  Dispatched {dateTime(data.dispatchedAt)} · Signed{" "}
                  {dateTime(data.signedAt)} · ETA{" "}
                  {str(data.etaStart).slice(0, 10)} –{" "}
                  {str(data.etaEnd).slice(0, 10)} ({str(data.timezone)})
                </p>
                <p className={s.notice}>{str(data.inventoryNote)}</p>
                <div className={s.actions}>
                  {!!data.purchaseId && caps.includes("procurement") && (
                    <Link href={href("purchases", data.purchaseId)}>
                      Purchase
                    </Link>
                  )}
                  {!!data.transferId && (
                    <Link
                      href={
                        "/admin/operations?section=transfers&id=" +
                        data.transferId
                      }
                    >
                      Transfer and warehouse acceptance
                    </Link>
                  )}
                  {!!data.orderId && (
                    <Link
                      href={
                        "/admin/operations?section=orders&id=" + data.orderId
                      }
                    >
                      Order fulfilment / customer return acceptance
                    </Link>
                  )}
                </div>
                <Table
                  rows={list(data.lines)}
                  columns={[
                    {
                      key: "variantId",
                      label: "SKU",
                      render: (r) =>
                        str(
                          list(meta.skus).find((x) => x.id === r.variantId)
                            ?.sku,
                        ),
                    },
                    { key: "quantity", label: "Allocated units" },
                  ]}
                />
                {action === "event" &&
                  form(
                    "transport event",
                    [
                      select("event", "Observed event", [
                        "DISPATCHED",
                        "IN_TRANSIT",
                        "SIGNED",
                        "EXCEPTION",
                        "LOST",
                        "RETURNED",
                        "ETA_CHANGED",
                        "NOTE",
                      ]),
                      reference,
                      occurred,
                      select("source", "Source", ["MANUAL", "TEST"]),
                      f("etaStart", "New ETA from (ETA change only)", "date"),
                      f("etaEnd", "New ETA by (ETA change only)", "date"),
                    ],
                    `logistics/${id}/event`,
                    {},
                    { source: "MANUAL", event: "IN_TRANSIT" },
                  )}
                {action === "receive" && data.receiving && (
                  <Receive
                    purchaseId={str(obj(data.receiving).purchaseId)}
                    parcelId={id}
                    meta={meta}
                    onSaved={refresh}
                  />
                )}
                <h2>Transport timeline</h2>
                <Table
                  rows={list(data.events)}
                  columns={[
                    { key: "event", label: "Event" },
                    { key: "source", label: "Source" },
                    {
                      key: "occurredAt",
                      label: "Actual event",
                      render: (r) => dateTime(r.occurredAt),
                    },
                    {
                      key: "createdAt",
                      label: "Recorded",
                      render: (r) => dateTime(r.createdAt),
                    },
                    { key: "reason", label: "Evidence / reason" },
                  ]}
                />
                <h2>Warehouse acceptance</h2>
                <Table
                  rows={list(data.receipts)}
                  columns={[
                    { key: "reference", label: "Reference" },
                    {
                      key: "occurredAt",
                      label: "Actual acceptance",
                      render: (r) => dateTime(r.occurredAt),
                    },
                    { key: "reason", label: "Evidence" },
                  ]}
                />
                {caps.includes("finance") && (
                  <>
                    <h2>Referenced fees</h2>
                    <p>
                      Included charges reference the original purchase
                      obligation. Independent charges are separate expenses;
                      linking does not add a second amount.
                    </p>
                    <Table
                      rows={list(data.fees)}
                      columns={[
                        { key: "expense.number", label: "Expense" },
                        { key: "meaning", label: "Treatment" },
                        {
                          key: "expense.amount",
                          label: "Amount",
                          render: (r) =>
                            money(
                              obj(r.expense).amount,
                              obj(r.expense).currency,
                            ),
                        },
                      ]}
                      select={(r) =>
                        router.push(href("expenses", obj(r.expense).id))
                      }
                    />
                    <Link href={href("expenses")}>
                      Manage and link expenses
                    </Link>
                  </>
                )}
              </>
            )}
            <Notifications items={list(data.notifications)} />
            {["purchases", "expenses", "logistics"].includes(section) && (
              <Attachments
                type={
                  section === "purchases"
                    ? "purchase"
                    : section === "expenses"
                      ? "expense"
                      : "parcel"
                }
                id={id}
              />
            )}
            <section className={s.box}>
              <h2>Audit timeline</h2>
              <Timeline rows={list(data.history)} />
              {list(data.history).length > 0 && (
                <details>
                  <summary>Revision details</summary>
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      fontSize: 12,
                    }}
                  >
                    {JSON.stringify(data.history, null, 2)}
                  </pre>
                </details>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
function FeeLink({
  expense,
  meta,
  onSaved,
}: {
  expense: Row;
  meta: Row;
  onSaved: () => void;
}) {
  const [type, setType] = useState("parcel");
  const rows = list(
    meta[
      {
        parcel: "parcels",
        transfer: "transfers",
        order: "orders",
        subscription: "recurring",
      }[type] || "parcels"
    ],
  );
  return (
    <section className={s.box}>
      <label>
        Business type
        <Select
          aria-label="Business type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {["parcel", "transfer", "order", "subscription"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
      </label>
      <BusinessForm
        key={type}
        title="fee link"
        fields={[
          {
            ...f("objectId", "Business record", "select", true),
            options: recordOptions(
              rows,
              type === "subscription" ? "name" : "number",
            ),
          },
        ]}
        endpoint={`expenses/${expense.id}/link`}
        extra={{
          objectType: type,
          meaning: expense.purchaseId
            ? "INCLUDED_IN_PURCHASE"
            : "INDEPENDENT_FEE",
        }}
        meta={meta}
        onSaved={() => onSaved()}
      />
    </section>
  );
}
