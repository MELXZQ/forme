"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Table,
  obj,
  list,
  str,
  num,
  dateTime,
  type Row,
} from "../operations/ui";
import { Attachments, businessApi } from "../business/forms";
import {
  api,
  Form,
  f,
  choose,
  people,
  reason,
  occurred,
  type Field,
} from "./forms";
import s from "../operations/Operations.module.css";
const href = (section: string, id?: unknown) =>
  "/admin/sales?section=" +
  section +
  (id ? "&id=" + encodeURIComponent(str(id)) : "");
const money = (v: unknown) =>
  v == null ? "Unknown" : "AUD " + (num(v) / 100).toFixed(2);
const label = (key: string) =>
  key
    .replace(/Cents$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ");
const columns = (keys: string[]) =>
  keys.map((key) => ({
    key,
    label: label(key),
    render: (r: Row) =>
      key.endsWith("Cents")
        ? money(r[key])
        : key.endsWith("At") || key === "deadline"
          ? dateTime(r[key])
          : str(r[key]),
  }));
function Facts({ data }: { data: Row }) {
  return (
    <dl className={s.stats}>
      {Object.entries(data).map(([k, v]) => (
        <div key={k}>
          <dt>{label(k)}</dt>
          <dd>
            {v == null
              ? "Unknown"
              : typeof v === "object"
                ? Object.entries(obj(v))
                    .map(
                      ([key, value]) =>
                        key + ": " + (value == null ? "Unknown" : str(value)),
                    )
                    .join(" · ")
                : typeof v === "number" &&
                    (k.endsWith("Cents") ||
                      [
                        "merchandise",
                        "discount",
                        "shipping",
                        "received",
                        "refunded",
                        "net",
                      ].includes(k))
                  ? money(v)
                  : str(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function Timeline({ items }: { items: Row[] }) {
  return (
    <section className={s.box}>
      <h2>Business timeline</h2>
      {items.length ? (
        items.map((e) => (
          <details key={str(e.id)}>
            <summary>
              {str(e.type)} · actual {dateTime(e.occurredAt)} · recorded{" "}
              {dateTime(e.recordedAt)} · {str(e.source)} / {str(e.dataKind)}
            </summary>
            <p>Operator: {str(e.actorId) || "Unknown"}</p>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {JSON.stringify({ before: e.before, after: e.after }, null, 2)}
            </pre>
          </details>
        ))
      ) : (
        <p>
          No reliable recorded events. Historical missing times remain unknown.
        </p>
      )}
    </section>
  );
}
function Filter({
  section,
  owner,
  customerAccess,
  params,
  meta,
}: {
  meta: Row;
  section: string;
  owner: boolean;
  customerAccess: boolean;
  params: URLSearchParams;
}) {
  const router = useRouter();
  const analytics = section === "analytics";
  const fields: Field[] = analytics
    ? [
        f("from", "From", "date", true),
        f("to", "Through", "date", true),
        f("asOf", "Cohort refund cutoff", "date", true),
        choose("timezone", "Report timezone", [
          "Australia/Melbourne",
          "Asia/Shanghai",
        ]),
        choose("dataKind", "Data view", ["REAL", "TEST"]),
        choose("bucket", "Trend interval", ["day", "week", "month"]),
        f("sku", "Historical SKU"),
        f("product", "Historical product ID"),
        f("category", "Historical category ID"),
        f("collection", "Historical collection ID"),
        f("campaign", "Campaign ID"),
      ]
    : [
        f("q", "Order number"),
        f("name", "Recipient name"),
        ...(customerAccess ? [f("email", "Guest email (not an account)")] : []),
        ...(owner ? [f("reference", "Payment reference")] : []),
        f("tracking", "Tracking number"),
        choose("dateField", "Date basis", [
          "created",
          "paid",
          "shipped",
          "delivered",
          "cancelled",
          "refunded",
        ]),
        f("from", "From", "date"),
        f("to", "Through", "date"),
        choose("timezone", "Filter timezone", [
          "Australia/Melbourne",
          "Asia/Shanghai",
        ]),
        f("sku", "Historical SKU"),
        f("product", "Historical product ID"),
        f("category", "Historical category ID"),
        f("collection", "Historical collection ID"),
        f("size", "Size"),
        f("color", "Color"),
        choose("payment", "Payment", [
          "PENDING",
          "PAID",
          "FAILED",
          "EXPIRED",
          "REVIEW",
        ]),
        choose("fulfillment", "Fulfillment", [
          "UNFULFILLED",
          "SHIPPED",
          "CANCELLED",
        ]),
        choose("transport", "Transport", [
          "NOT_SHIPPED",
          "IN_TRANSIT",
          "DELIVERED",
          "EXCEPTION",
        ]),
        choose("aftercare", "Aftercare", [
          "OPEN",
          "PROCESSING",
          "WAITING_CUSTOMER",
          "WAITING_EXTERNAL",
          "PENDING_APPROVAL",
          "PENDING_EXECUTION",
          "RESOLVED",
          "CLOSED",
        ]),
        choose("compensation", "Compensation", [
          "SUBMITTED",
          "APPROVED",
          "EXECUTING",
          "FAILED",
          "COMPLETED",
        ]),
        choose("exception", "Exception", [
          "unverified",
          "inventory",
          "shipment",
          "delivery",
          "aftercare",
          "compensation",
        ]),
        choose("deal", "Reference-price offer", ["yes", "no", "unknown"]),
        f("campaign", "Campaign ID"),
        f("state", "Delivery state"),
        f("postcode", "Postcode"),
        f("carrier", "Carrier"),
        choose("shippingMethod", "Delivery method", ["STANDARD_AU"]),
        choose("dataKind", "Data view", ["ALL", "REAL", "TEST", "UNKNOWN"]),
        ...(owner
          ? [
              choose("amountField", "Amount basis", [
                "payable",
                "merchandise",
                "received",
                "discount",
                "refunded",
              ]),
              f("min", "Minimum AUD cents", "number"),
              f("max", "Maximum AUD cents", "number"),
              choose("refund", "Confirmed refund", ["none", "partial", "full"]),
            ]
          : []),
        choose("sort", "Stable order", [
          "newest",
          "oldest",
          "amount_desc",
          "amount_asc",
        ]),
      ];
  for (const field of fields) {
    const records =
      field.name === "product"
        ? list(meta.historicalProducts).map((x) => ({
            id: x.productId,
            name: x.productName,
          }))
        : field.name === "category"
          ? list(meta.historicalCategories).map((x) => ({
              id: x.categoryId,
              name: x.categoryName,
            }))
          : field.name === "collection"
            ? list(meta.historicalCollections)
            : field.name === "campaign"
              ? list(meta.campaigns)
              : null;
    if (records) {
      field.type = "select";
      field.options = records.map((r) => ({
        value: str(r.id),
        label: str(r.name),
      }));
      field.label = field.label.replace(" ID", "");
    }
  }
  return (
    <form
      className={s.box}
      key={params.toString()}
      onSubmit={(e) => {
        e.preventDefault();
        const q = new URLSearchParams({ section });
        for (const [k, v] of new FormData(e.currentTarget))
          if (str(v)) q.set(k, str(v));
        router.push("/admin/sales?" + q);
      }}
    >
      <details open={analytics}>
        <summary>Filters · saved in the page URL</summary>
        <div className={s.grid}>
          {fields.map((field) => (
            <label key={field.name}>
              {field.label}
              {field.type === "select" ? (
                <select
                  name={field.name}
                  defaultValue={params.get(field.name) || ""}
                >
                  <option value="">Default / all</option>
                  {field.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={field.name}
                  type={field.type || "text"}
                  required={field.required}
                  defaultValue={params.get(field.name) || ""}
                />
              )}
            </label>
          ))}
        </div>
        <button className={s.button}>Apply filters</button>{" "}
        <Link href={href(section)}>Clear all</Link>
        <p>
          Guest email is a contact field, not a verified customer account. No
          coupon code or customer-account filters are offered.
        </p>
      </details>
      <div className={s.actions}>
        {["day", "week", "month"].map((p, i) => (
          <button
            type="button"
            className={s.secondary}
            key={p}
            onClick={() => {
              const q = new URLSearchParams(params);
              const end = new Date().toLocaleDateString("en-CA", {
                timeZone: params.get("timezone") || "Australia/Melbourne",
              });
              const start = new Date(
                Date.parse(end) - ([1, 7, 30][i] - 1) * 86400000,
              )
                .toISOString()
                .slice(0, 10);
              q.set("section", section);
              q.set("from", start);
              q.set("to", end);
              if (analytics) q.set("asOf", end);
              q.delete("page");
              router.push("/admin/sales?" + q);
            }}
          >
            Last {i === 0 ? "day" : i === 1 ? "7 days" : "30 days"}
          </button>
        ))}
      </div>
      {[...params]
        .filter(([k]) => !["section", "page", "id"].includes(k))
        .map(([k, v]) => {
          const q = new URLSearchParams(params);
          q.delete(k);
          q.delete("page");
          return (
            <Link key={k} className={s.secondary} href={"/admin/sales?" + q}>
              {fields.find((f) => f.name === k)?.label || label(k)}:{" "}
              {fields
                .find((f) => f.name === k)
                ?.options?.find((o) => o.value === v)?.label || v}{" "}
              ×{" "}
            </Link>
          );
        })}
    </form>
  );
}
function SavedFilters({
  meta,
  params,
  onSaved,
}: {
  meta: Row;
  params: URLSearchParams;
  onSaved: () => void;
}) {
  return (
    <section className={s.box}>
      <h2>My saved filters</h2>
      {list(meta.filters).map((x) => (
        <p key={str(x.id)}>
          <Link
            href={
              "/admin/sales?section=orders&" +
              new URLSearchParams(
                Object.entries(obj(x.query))
                  .filter(([, v]) => v != null)
                  .map(([k, v]) => [k, str(v)]),
              )
            }
          >
            {str(x.name)}
          </Link>{" "}
          <button
            onClick={async () => {
              await api("filters", {
                key: crypto.randomUUID(),
                reason: "Remove my saved filter",
                name: x.name,
                query: {},
                remove: true,
              });
              onSaved();
            }}
          >
            Remove
          </button>
        </p>
      ))}
      <Form
        title="personal filter"
        fields={[f("name", "Filter name", "text", true), reason]}
        extra={{
          query: Object.fromEntries(
            [...params].filter(
              ([k]) => !["section", "id", "new", "page"].includes(k),
            ),
          ),
        }}
        endpoint="filters"
        onSaved={onSaved}
      />
    </section>
  );
}
function Report({
  data,
  params,
  canExport,
}: {
  data: Row;
  params: URLSearchParams;
  canExport: boolean;
}) {
  const t = obj(data.totals),
    max = Math.max(
      1,
      ...list(data.trend).map((p) =>
        Math.max(num(p.received), num(p.refunded)),
      ),
    );
  const q = obj(data.filters);
  const drill = (from: string, to = from, dateField = "paid") =>
    href("orders") +
    "&" +
    new URLSearchParams({
      dateField,
      from,
      to,
      timezone: str(q.timezone),
      dataKind: str(q.dataKind),
      ...Object.fromEntries(
        ["product", "sku", "category", "collection", "campaign"]
          .filter((k) => q[k])
          .map((k) => [k, str(q[k])]),
      ),
    });
  return (
    <>
      <p className={s.notice}>
        {str(q.dataKind)} data · AUD · {str(q.from)} through {str(q.to)} ·{" "}
        {str(q.timezone)} · refund cutoff {str(q.asOf)}. Net cash is not profit.
      </p>
      <Facts data={t} />
      <p>
        Tax: {str(data.tax)}. Report generated {dateTime(data.generatedAt)}.
      </p>
      <section className={s.box}>
        <h2>Receipts and refunds by actual event time</h2>
        {list(data.trend).length ? (
          <div>
            {list(data.trend).map((p) => {
              const start =
                str(p.period) + (str(q.bucket) === "month" ? "-01" : "");
              const d = new Date(start);
              if (q.bucket === "week") d.setUTCDate(d.getUTCDate() + 6);
              if (q.bucket === "month") {
                d.setUTCMonth(d.getUTCMonth() + 1);
                d.setUTCDate(0);
              }
              const end = d.toISOString().slice(0, 10);
              const visibleStart = start < str(q.from) ? str(q.from) : start;
              const visibleEnd = end > str(q.to) ? str(q.to) : end;
              return (
                <div key={str(p.period)} style={{ margin: "14px 0" }}>
                  <Link href={drill(visibleStart, visibleEnd)}>
                    {str(p.period)} · receipts {money(p.received)}
                  </Link>
                  {" · "}
                  <Link href={drill(visibleStart, visibleEnd, "refunded")}>
                    refunds {money(p.refunded)}
                  </Link>
                  <div style={{ height: 10, background: "#dcd9ce" }}>
                    <div
                      style={{
                        height: "100%",
                        width: (100 * num(p.received)) / max + "%",
                        background: "#364c43",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      height: 6,
                      width: (100 * num(p.refunded)) / max + "%",
                      background: "#ab664c",
                    }}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <p>No confirmed payments or refunds in this period.</p>
        )}
      </section>
      <p>
        Previous equal elapsed period: {dateTime(obj(data.previous).from)} to{" "}
        {dateTime(obj(data.previous).to)}; receipts{" "}
        {money(obj(data.previous).received)};{" "}
        {obj(data.previous).changePercent == null
          ? "No comparable baseline"
          : num(obj(data.previous).changePercent).toFixed(1) + "% change"}
        .
      </p>
      <p>
        Whole-order receipts and shipping are shown alongside matching
        merchandise; product filtering does not allocate whole-order cash to
        matching items.
      </p>
      {Object.entries(obj(data.dimensions)).map(([dimension, rows]) => (
        <section className={s.box} key={dimension}>
          <h2>{dimension} performance</h2>
          {["collection", "campaign"].includes(dimension) && (
            <p>
              Overlapping membership — do not add these rows to obtain the store
              total. Campaign rows are associated sales, not proven incremental
              sales.
            </p>
          )}
          <Table
            rows={list(rows)}
            columns={[
              {
                key: "name",
                label: "Name / interval",
                render: (r) =>
                  dimension === "unitBand" ? (
                    str(r.name)
                  ) : (
                    <Link
                      href={
                        href("orders") +
                        "&" +
                        new URLSearchParams({
                          [dimension]:
                            dimension === "sku" ? str(r.name) : str(r.id),
                          dateField: "paid",
                          from: str(q.from),
                          to: str(q.to),
                          timezone: str(q.timezone),
                          dataKind: str(q.dataKind),
                        })
                      }
                    >
                      {str(r.name)}
                    </Link>
                  ),
              },
              ...columns(["orders", "units"]),
              {
                key: "amount",
                label: "Matching merchandise",
                render: (r) => money(r.amount),
              },
              {
                key: "discount",
                label: "Known actual discount",
                render: (r) => money(r.discount),
              },
              {
                key: "refund",
                label: "Reliably allocated cohort refund",
                render: (r) => money(r.refund),
              },
            ]}
          />
        </section>
      ))}
      <section className={s.box}>
        <h2>Order value intervals (AUD, orders)</h2>
        <Facts data={obj(data.orderBands)} />
        <h2>Delivery states (paid orders)</h2>
        <Facts data={obj(data.states)} />
        <h2>Cancellation reasons</h2>
        <Facts data={obj(data.cancellationReasons)} />
        <h2>Aftercare reasons</h2>
        <Facts data={obj(data.aftercareReasons)} />
        <h2>Fulfillment sample</h2>
        <p>
          Averages use completed records through the cutoff; unfinished counts
          use the same cutoff. Overdue shows currently active shipping and
          delivery timers, excluding pauses.
        </p>
        <Facts data={obj(data.fulfillment)} />
        <h2>Payment cohort</h2>
        <Facts data={obj(data.cohort)} />
        <h2>Known stockout intervals</h2>
        <Table
          rows={list(data.stockout)}
          columns={columns(["skuId", "knownSince", "hours"])}
        />
        <p>
          Only intervals after a reliable recorded Melbourne balance. Missing
          history remains unknown.{" "}
          {data.stockHistoryLimited
            ? "Range too large; narrow the report."
            : ""}
        </p>
      </section>
      {list(data.campaignComparison).length > 0 && (
        <section className={s.box}>
          <h2>Same-SKU campaign window comparison</h2>
          <p>
            Current campaign definition version{" "}
            {str(data.campaignComparisonVersion)}; before/during/after use equal
            elapsed windows, clipped at the report cutoff. This is associated
            SKU performance, not an estimate of campaign-generated incremental
            sales.
          </p>
          <Table
            rows={list(data.campaignComparison)}
            columns={columns([
              "window",
              "from",
              "to",
              "orders",
              "units",
              "merchandise",
            ])}
          />
        </section>
      )}
      <p>
        Refunds without reliable merchandise-line allocation (including
        non-merchandise components): {money(data.refundsWithoutLineAllocation)}.
        Do not attribute these to campaigns.
      </p>
      <h2>Matching order details</h2>
      <Table
        rows={list(data.rows)}
        columns={columns([
          "number",
          "paidAt",
          "orderCents",
          "matchedCents",
          "cohortRefundCents",
        ])}
        select={(r) => window.location.assign(href("orders", r.id))}
      />
      <p>
        Historical paid orders without verified event attribution:{" "}
        {str(data.unknownHistoricalPaidOrders)}. Unattributed merchandise:{" "}
        {money(data.unattributedMerchandise)}.
      </p>
      <ul>
        {((data.notes as string[]) || []).map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      {canExport && (
        <a
          className={s.button}
          href={
            "/api/sales/analytics?" +
            new URLSearchParams([...params].filter(([k]) => k !== "section")) +
            "&format=csv"
          }
        >
          Export statistics CSV
        </a>
      )}
    </>
  );
}
function CaseForm({
  meta,
  initial,
  order,
  onSaved,
}: {
  meta: Row;
  initial: Row;
  order: Row;
  onSaved: (v: Row) => void;
}) {
  return (
    <Form
      title="aftercare case"
      endpoint="cases"
      initial={{
        assigneeId: obj(meta.actor).id,
        priority: 1,
        type: "OTHER",
        source: "CUSTOMER_REPORTED",
        dueAt: new Date(
          Date.parse(str(meta.today) || "1970-01-01") + 7 * 86400000,
        ).toISOString(),
        ...initial,
      }}
      extra={{
        orderId: order.id,
        ...(initial.id ? { id: initial.id, version: initial.version } : {}),
      }}
      fields={[
        choose(
          "type",
          "Issue type",
          [
            "NOT_RECEIVED",
            "DELAY",
            "DAMAGE",
            "SHORT_OR_WRONG",
            "RETURN",
            "OTHER",
          ],
          true,
        ),
        choose(
          "source",
          "Reported source",
          ["CUSTOMER_REPORTED", "STAFF", "TEST"],
          true,
        ),
        f("summary", "Customer feedback summary", "textarea", true),
        {
          ...f("lineId", "Related order line", "select"),
          options: list(order.lines).map((l) => ({
            value: str(l.id),
            label: str(l.sku),
          })),
        },
        f("quantity", "Affected units", "number"),
        {
          ...f("parcelId", "Related parcel", "select"),
          options: list(order.parcels).map((p) => ({
            value: str(p.id),
            label: str(p.number),
          })),
        },
        people(list(meta.people)),
        f("priority", "Priority 0–3", "number", true),
        f("dueAt", "Handling deadline", "datetime-local", true),
        occurred,
        reason,
      ]}
      onSaved={onSaved}
    />
  );
}
function CompForm({
  meta,
  initial,
  caseId,
  order,
  onSaved,
}: {
  meta: Row;
  initial: Row;
  caseId: string;
  order: Row;
  onSaved: (v: Row) => void;
}) {
  const quantities = Object.fromEntries(
    list(initial.lines).map((l) => ["qty_" + l.variantId, l.quantity]),
  );
  return (
    <Form
      title="compensation request"
      endpoint="compensations"
      initial={{
        type: "PARTIAL_REFUND",
        amountCents: 0,
        executorId: obj(meta.actor).id,
        dueAt: new Date(
          Date.parse(str(meta.today) || "1970-01-01") + 7 * 86400000,
        ).toISOString(),
        ...initial,
        ...quantities,
      }}
      extra={{
        caseId,
        currency: "AUD",
        ...(initial.id ? { id: initial.id, version: initial.version } : {}),
      }}
      fields={[
        choose(
          "type",
          "Compensation type",
          [
            "SHIPPING_REFUND",
            "PARTIAL_REFUND",
            "FULL_REFUND",
            "REPLACEMENT",
            "COUPON",
            "OTHER",
          ],
          true,
        ),
        f("amountCents", "Requested AUD amount (refund only)", "amount", true),
        f("basis", "Verified basis / evidence", "textarea", true),
        people(list(meta.people), "executorId", "Executor"),
        f("dueAt", "Execution deadline", "datetime-local", true),
        ...list(order.lines).map((l) => ({
          ...f(
            "qty_" + l.variantId,
            "Replacement quantity · " + str(l.sku),
            "number",
          ),
          help: "Only for REPLACEMENT. Leave blank or 0 for other types.",
        })),
        reason,
      ]}
      prepare={(v) => {
        const lines = list(order.lines)
          .filter((l) => num(v["qty_" + l.variantId]) > 0)
          .map((l) => ({
            variantId: l.variantId,
            quantity: num(v["qty_" + l.variantId]),
          }));
        const clean = Object.fromEntries(
          Object.entries(v).filter(([k]) => !k.startsWith("qty_")),
        );
        return { ...clean, lines };
      }}
      onSaved={onSaved}
    />
  );
}
export function SalesApp() {
  const router = useRouter(),
    search = useSearchParams(),
    section = search.get("section") || "home",
    id = search.get("id"),
    isNew = search.get("new") === "1";
  const query = search.toString();
  const [meta, setMeta] = useState<Row>({}),
    [loadedData, setData] = useState<Row | null>(null),
    [loadedRelated, setRelated] = useState<Row>({}),
    [loadedKey, setLoadedKey] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0),
    [action, setAction] = useState(""),
    [proofs, setProofs] = useState<Row[]>([]),
    [editingRule, setEditingRule] = useState<Row>({});
  const viewKey = query + ":" + revision;
  const data = loadedKey === viewKey ? loadedData : null;
  const related = loadedKey === viewKey ? loadedRelated : {};
  const owner = obj(meta.actor).role === "admin",
    caps = (meta.capabilities || []) as string[];
  useEffect(() => {
    let live = true;
    api("meta")
      .then((m) => {
        if (live) setMeta(m);
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
        setRelated({});
        setError("");
        setAction("");
        setProofs([]);
      }
    });
    async function load() {
      const q = new URLSearchParams(query);
      ["section", "id", "new", "case", "order"].forEach((k) => q.delete(k));
      if (section === "analytics") {
        const today = new Date().toLocaleDateString("en-CA", {
          timeZone: q.get("timezone") || "Australia/Melbourne",
        });
        if (!q.has("to")) q.set("to", today);
        if (!q.has("from")) {
          q.set(
            "from",
            new Date(Date.parse(today) - 29 * 86400000)
              .toISOString()
              .slice(0, 10),
          );
        }
        if (!q.has("asOf")) q.set("asOf", today);
      }
      let d: Row = {};
      if (!isNew)
        d = await api(section + (id ? "/" + encodeURIComponent(id) : "?" + q));
      let orderId = str(d.orderId) || new URLSearchParams(query).get("order");
      const caseId = new URLSearchParams(query).get("case");
      if (isNew && section === "compensations" && caseId) {
        const c = await api("cases/" + caseId);
        orderId = str(c.orderId);
      }
      if (orderId) {
        const o = await api("orders/" + orderId);
        if (live) setRelated(o);
      }
      if (live) {
        setData(d);
        setLoadedKey(query + ":" + revision);
      }
    }
    load().catch((e) => {
      if (live) setError(e.message);
    });
    return () => {
      live = false;
    };
  }, [query, section, id, isNew, revision]);
  const refresh = () => {
    setNotice("Saved successfully.");
    setRevision((v) => v + 1);
  };
  const saved = (v: Row) => {
    setNotice("Saved successfully.");
    if (isNew && v.id) router.push(href(section, v.id));
    else refresh();
  };
  const titles: Record<string, string> = {
    home: "My work",
    orders: "Advanced orders",
    analytics: "Sales & cash",
    cases: "Aftercare",
    compensations: "Compensation",
    rules: "Order timeout rules",
    campaigns: "Deals associations",
  };
  const actions =
    section === "orders"
      ? [
          "NOTE",
          "ETA",
          "DELIVERED",
          ...(owner ? ["ADDRESS", "ASSIGN", "PAYMENT"] : []),
        ]
      : section === "cases"
        ? [
            "RESPONSE",
            "NOTE",
            "COMMUNICATION_DRAFT",
            "COMMUNICATION_RECORDED",
            "STATUS",
            "REOPEN",
            "EDIT",
          ]
        : section === "compensations"
          ? [
              "EDIT",
              "SUBMIT",
              ...(owner ? ["APPROVE", "REJECT", "REFUND"] : []),
              "RESERVE_REPLACEMENT",
              "SHIP_REPLACEMENT",
              "FAIL",
              "CANCEL",
              "OTHER_COMPLETE",
            ]
          : [];
  const evidence: Field = {
    ...f("evidenceId", "Private evidence image", "select", true),
    options: proofs.map((p) => ({
      value: str(p.id),
      label: str(p.originalName),
    })),
  };
  const readyParams = new URLSearchParams(query);
  if (section === "analytics" && data?.filters)
    for (const [k, v] of Object.entries(obj(data.filters)))
      if (v != null) readyParams.set(k, str(v));
  const form = (
    title: string,
    fields: Field[],
    endpoint: string,
    extra: Row = {},
    initial: Row = {},
    prepare?: (v: Row) => Row,
  ) => (
    <Form
      key={action + revision + str(editingRule.id) + title}
      title={title}
      fields={[...fields, reason]}
      endpoint={endpoint}
      extra={extra}
      initial={initial}
      prepare={prepare}
      onSaved={saved}
    />
  );
  const exportQuery = new URLSearchParams(
    [...search].filter(([k]) => !["section", "id"].includes(k)),
  );
  exportQuery.set("format", "csv");
  return (
    <div className={s.root}>
      <nav className={s.nav}>
        <span className={s.brand}>FORME · Orders & care</span>
        {[
          "home",
          "orders",
          "cases",
          "compensations",
          ...(owner || caps.includes("orderStats") ? ["analytics"] : []),
          ...(owner || caps.includes("orderRules") ? ["rules"] : []),
          ...(owner ? ["campaigns"] : []),
        ].map((k) => (
          <Link
            key={k}
            className={section === k ? s.active : ""}
            href={href(k)}
          >
            {titles[k]}
          </Link>
        ))}
        <Link href="/admin/notifications">Notifications</Link>
        <Link href="/admin/operations">Stock & fulfillment</Link>
        <Link href="/admin/business">Purchases & expenses</Link>
        <Link href="/">Storefront</Link>
      </nav>
      <main id="main" className={s.content}>
        <div className={s.heading}>
          <h1>{titles[section] || section}</h1>
          {(id || isNew) && <Link href={href(section)}>Back to list</Link>}
        </div>
        <p>
          Local operations · No payment, refund, carrier or email service is
          connected. Approval is separate from actual execution.
        </p>
        {notice && !isNew && (
          <p className={s.notice} role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {!data && !error && <p>Loading…</p>}
        {section === "home" && data && (
          <>
            <p>
              {owner ? "Owner overview" : "Melbourne fulfillment overview"} ·{" "}
              {str(data.today)} · {str(data.timezone)}
            </p>
            <div className={s.actions}>
              {[
                ["all", "All unfinished"],
                ["mine", "My responsibility"],
                ["approval", "Awaiting my approval"],
                ["confirmation", "Awaiting my confirmation"],
                ["overdue", "Overdue"],
                ["unassigned", "Unassigned"],
              ].map(([k, label]) => (
                <Link
                  key={k}
                  className={s.secondary}
                  href={href("home") + "&view=" + k}
                >
                  {label}
                </Link>
              ))}
            </div>
            <Table
              rows={list(data.items)}
              columns={[
                {
                  key: "title",
                  label: "Business item",
                  render: (r) => <Link href={str(r.href)}>{str(r.title)}</Link>,
                },
                ...columns(["source", "reason", "status", "deadline"]),
                {
                  key: "assigneeId",
                  label: "Responsible person",
                  render: (r) =>
                    str(
                      list(data.people).find((p) => p.id === r.assigneeId)
                        ?.name,
                    ) || "Unassigned",
                },
                ...columns(["action"]),
              ]}
            />
            <section className={s.box}>
              <h2>Today + pinned notifications</h2>
              <p>
                Reading or confirming a notice does not resolve the business
                task.
              </p>
              {list(obj(data.notifications).items).map((n) => (
                <p key={str(n.id)}>
                  <Link href={"/admin/notifications?id=" + n.id}>
                    {n.pinned ? "Pinned · " : ""}
                    {str(n.title)}
                  </Link>{" "}
                  · {str(n.status)}
                  {n.needsConfirmation
                    ? " · Your confirmation is required"
                    : ""}
                </p>
              ))}
              <Link href="/admin/notifications">
                Open full notification centre
              </Link>
            </section>
          </>
        )}
        {(section === "orders" || section === "analytics") &&
          !id &&
          !isNew &&
          data &&
          !!meta.actor && (
            <>
              <Filter
                meta={meta}
                section={section}
                owner={owner || caps.includes("orderStats")}
                customerAccess={owner || caps.includes("customerExport")}
                params={readyParams}
              />
              {section === "orders" && (
                <SavedFilters meta={meta} params={search} onSaved={refresh} />
              )}
            </>
          )}
        {section === "analytics" && data && (
          <Report
            data={data}
            params={readyParams}
            canExport={owner || caps.includes("orderExport")}
          />
        )}
        {["orders", "cases", "compensations", "campaigns"].includes(section) &&
          !id &&
          !isNew &&
          data && (
            <>
              {["cases", "compensations"].includes(section) && (
                <form
                  className={s.filters}
                  onSubmit={(e) => {
                    e.preventDefault();
                    router.push(
                      href(section) +
                        "&" +
                        new URLSearchParams(
                          new FormData(e.currentTarget) as never,
                        ),
                    );
                  }}
                >
                  <label>
                    Number
                    <input name="q" defaultValue={search.get("q") || ""} />
                  </label>
                  <label>
                    Status
                    <input
                      name="status"
                      defaultValue={search.get("status") || ""}
                    />
                  </label>
                  <button>Apply filters</button>
                  <Link href={href(section)}>Clear</Link>
                </form>
              )}
              {section === "cases" && (
                <p>
                  Open an order and choose New aftercare case. Evidence stays
                  linked to that order.
                </p>
              )}
              {section === "compensations" && (
                <p>
                  Open an aftercare case to request compensation. Coupons remain
                  pending until a usable engine exists.
                </p>
              )}
              {section === "campaigns" && (
                <Link className={s.button} href={href("campaigns") + "&new=1"}>
                  New Deals association
                </Link>
              )}
              {section === "orders" && data.summary && (
                <section className={s.box}>
                  <h2>All matching orders · AUD</h2>
                  <Facts data={obj(obj(data.summary).wholeOrders)} />
                  <h3>Matching merchandise only</h3>
                  <Facts data={obj(obj(data.summary).matchedLines)} />
                  <p>
                    Unknown actual discounts:{" "}
                    {str(obj(data.summary).unknownDiscountOrders)} orders.
                    Whole-order totals count each order once.
                  </p>
                </section>
              )}
              <Table
                rows={list(data.items)}
                columns={
                  section === "orders"
                    ? columns([
                        "number",
                        "createdAt",
                        "paymentStatus",
                        "fulfillmentStatus",
                        ...(owner
                          ? [
                              "dataKind",
                              "totalCents",
                              "matchedCents",
                              "refundCents",
                            ]
                          : []),
                        "state",
                        "trackingNumber",
                      ])
                    : section === "cases"
                      ? columns([
                          "number",
                          "type",
                          "summary",
                          "status",
                          "dueAt",
                        ])
                      : section === "compensations"
                        ? columns([
                            "number",
                            "type",
                            "status",
                            "amountCents",
                            "dueAt",
                            "selfApproved",
                          ])
                        : columns([
                            "name",
                            "version",
                            "startsAt",
                            "endsAt",
                            "active",
                          ])
                }
                select={(r) => {
                  if (section === "campaigns") {
                    setEditingRule(r);
                    setAction("CAMPAIGN");
                  } else router.push(href(section, r.id));
                }}
              />
              {data.total !== undefined && (
                <div className={s.actions}>
                  <button
                    disabled={num(data.page) <= 1}
                    onClick={() => {
                      const q = new URLSearchParams(search);
                      q.set("page", str(num(data.page) - 1));
                      router.push("/admin/sales?" + q);
                    }}
                  >
                    Previous
                  </button>
                  <span>
                    Page {str(data.page)} · {str(data.total)} matching records
                  </span>
                  <button
                    disabled={
                      num(data.page) * num(data.pageSize || 25) >=
                      num(data.total)
                    }
                    onClick={() => {
                      const q = new URLSearchParams(search);
                      q.set("page", str(num(data.page) + 1));
                      router.push("/admin/sales?" + q);
                    }}
                  >
                    Next
                  </button>
                </div>
              )}
              {section === "orders" &&
                (owner || caps.includes("orderExport")) && (
                  <p>
                    <a
                      className={s.button}
                      href={"/api/sales/orders?" + exportQuery}
                    >
                      Export minimal CSV
                    </a>{" "}
                    {(owner || caps.includes("customerExport")) && (
                      <a
                        href={"/api/sales/orders?" + exportQuery + "&pii=true"}
                      >
                        Export with authorized customer contact fields
                      </a>
                    )}
                  </p>
                )}
            </>
          )}
        {section === "orders" && id && data && (
          <>
            <Facts
              data={{
                number: data.number,
                payment: data.paymentStatus,
                fulfillment: data.fulfillmentStatus,
                dataKind: data.dataKind,
                actualDiscount: money(data.actualDiscountCents),
                payable: money(data.totalCents),
                refund: money(data.recordedRefundCents),
                tracking: data.trackingNumber,
              }}
            />
            <section className={s.box}>
              <h2>Delivery address</h2>
              <p>
                {[
                  data.recipientName,
                  data.addressLine1,
                  data.addressLine2,
                  data.city,
                  data.state,
                  data.postcode,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <p>{str(data.email)}</p>
              <p>
                Changing a stored address after dispatch does not contact the
                carrier.
              </p>
            </section>
            <h2>Frozen order lines</h2>
            <Table
              rows={list(data.lines)}
              columns={columns([
                "sku",
                "productName",
                "size",
                "color",
                "categoryName",
                "quantity",
                ...(owner
                  ? [
                      "unitPriceCents",
                      "originalUnitCents",
                      "actualDiscountCents",
                      "lineTotalCents",
                      "pricingBasis",
                    ]
                  : []),
              ])}
            />
            <p>
              Original unit price is the old reference-price field. Actual
              discounts are separate; legacy unknowns are not zero.
            </p>
            <div className={s.actions}>
              <Link
                className={s.button}
                href={href("cases") + "&new=1&order=" + id}
              >
                New aftercare case
              </Link>
              <Link href={"/admin/operations?section=orders&id=" + id}>
                Existing whole-order shipping / physical returns
              </Link>
            </div>
            <h2>Stock reservation</h2>
            <Table
              rows={list(data.reservations)}
              columns={columns([
                "variantId",
                "quantity",
                "status",
                "createdAt",
                "resolvedAt",
              ])}
            />
            <h2>Inventory effects</h2>
            <Table
              rows={list(data.ledger)}
              columns={columns([
                "kind",
                "variantId",
                "deltaOnHand",
                "deltaReserved",
                "createdAt",
              ])}
            />
            <h2>Parcels</h2>
            <Table
              rows={list(data.parcels)}
              columns={columns([
                "number",
                "type",
                "transportStatus",
                "trackingNumber",
                "dispatchedAt",
                "signedAt",
              ])}
              select={(r) =>
                router.push("/admin/business?section=logistics&id=" + r.id)
              }
            />
            <h2>Related aftercare</h2>
            <Table
              rows={list(data.cases)}
              columns={columns(["number", "type", "status", "dueAt"])}
              select={(r) => router.push(href("cases", r.id))}
            />
            <h2>Compensation</h2>
            <Table
              rows={list(data.compensations)}
              columns={columns(["number", "type", "status", "amountCents"])}
              select={(r) => router.push(href("compensations", r.id))}
            />
            {owner && (
              <>
                <h2>Referenced expenses (same cash record)</h2>
                {list(data.expenses).map((e) => (
                  <p key={str(e.id)}>
                    <Link
                      href={
                        "/admin/business?section=expenses&id=" + e.expenseId
                      }
                    >
                      {str(obj(e.expense).number)} · {str(e.meaning)}
                    </Link>
                  </p>
                ))}
              </>
            )}
            <h2>Timeouts and finite pauses</h2>
            <Table
              rows={list(data.timers)}
              columns={columns(["kind", "anchorAt", "deadlineAt", "active"])}
              select={
                owner || caps.includes("orderRules")
                  ? (r) => {
                      setEditingRule(r);
                      setAction("PAUSE");
                    }
                  : undefined
              }
            />
            {list(data.notifications).map((n) => (
              <p key={str(n.id)}>
                <Link href={"/admin/notifications?id=" + n.id}>
                  {str(n.title)}
                </Link>
              </p>
            ))}
          </>
        )}
        {id &&
          data &&
          ["orders", "cases", "compensations"].includes(section) && (
            <div className={s.actions}>
              {actions.map((a) => (
                <button
                  className={action === a ? s.button : s.secondary}
                  key={a}
                  onClick={() => setAction(action === a ? "" : a)}
                >
                  {a.replaceAll("_", " ")}
                </button>
              ))}
            </div>
          )}
        {section === "orders" &&
          id &&
          data &&
          action &&
          action !== "PAUSE" &&
          form(
            "order " + action.toLowerCase(),
            [
              occurred,
              ...(action === "NOTE" || action === "DELIVERED"
                ? [
                    f(
                      "content",
                      action === "NOTE"
                        ? "Internal note (never sent to customer)"
                        : "Delivery evidence",
                      "textarea",
                      true,
                    ),
                  ]
                : []),
              ...(action === "ETA"
                ? [f("eta", "Expected delivery date", "date", true)]
                : []),
              ...(action === "ASSIGN" ? [people(list(meta.people))] : []),
              ...(action === "PAYMENT"
                ? [
                    f(
                      "reference",
                      "Actual external payment reference",
                      "text",
                      true,
                    ),
                    evidence,
                  ]
                : []),
              ...(action === "ADDRESS"
                ? [
                    f("recipientName", "Recipient", "text", true),
                    f("addressLine1", "Address line 1", "text", true),
                    f("addressLine2", "Address line 2"),
                    f("city", "City", "text", true),
                    choose(
                      "state",
                      "State",
                      ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"],
                      true,
                    ),
                    f("postcode", "Postcode", "text", true),
                  ]
                : []),
            ],
            `orders/${id}/action`,
            { action },
            action === "ADDRESS" ? data : {},
            (v) => {
              if (action !== "ADDRESS") return v;
              const keys = [
                "recipientName",
                "addressLine1",
                "addressLine2",
                "city",
                "state",
                "postcode",
              ];
              const address = Object.fromEntries(
                keys.map((k) => [k, v[k] || ""]),
              );
              return {
                ...Object.fromEntries(
                  Object.entries(v).filter(([k]) => !keys.includes(k)),
                ),
                address,
              };
            },
          )}
        {action === "PAUSE" &&
          form(
            "finite timer pause",
            [f("endsAt", "Resume automatically at", "datetime-local", true)],
            `timers/${editingRule.id}/pause`,
          )}
        {section === "cases" &&
          isNew &&
          (related.id ? (
            <CaseForm
              key={str(related.id)}
              meta={meta}
              initial={{}}
              order={related}
              onSaved={saved}
            />
          ) : (
            <label>
              Choose an order
              <select
                value={search.get("order") || ""}
                onChange={(e) =>
                  router.push(href("cases") + "&new=1&order=" + e.target.value)
                }
              >
                <option value="">Choose…</option>
                {list(meta.recentOrders).map((o) => (
                  <option key={str(o.id)} value={str(o.id)}>
                    {str(o.number)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        {section === "cases" && id && data && (
          <>
            <Facts
              data={{
                number: data.number,
                type: data.type,
                status: data.status,
                summary: data.summary,
                dueAt: data.dueAt,
                firstResponseAt: data.firstResponseAt,
                outcome: data.outcome,
              }}
            />
            <Link href={href("orders", data.orderId)}>Original order</Link>{" "}
            <Link
              className={s.button}
              href={href("compensations") + "&new=1&case=" + id}
            >
              New compensation request
            </Link>
            {action === "EDIT" && related.id && (
              <CaseForm
                meta={meta}
                initial={data}
                order={related}
                onSaved={saved}
              />
            )}{" "}
            {action &&
              action !== "EDIT" &&
              form(
                "case " + action.toLowerCase(),
                [
                  occurred,
                  f(
                    "content",
                    action === "COMMUNICATION_DRAFT"
                      ? "Message draft — not sent"
                      : "Handling record / outcome",
                    "textarea",
                    true,
                  ),
                  ...(action === "STATUS"
                    ? [
                        choose(
                          "status",
                          "Next status",
                          [
                            "OPEN",
                            "PROCESSING",
                            "WAITING_CUSTOMER",
                            "WAITING_EXTERNAL",
                            "PENDING_APPROVAL",
                            "PENDING_EXECUTION",
                            "RESOLVED",
                            "CLOSED",
                          ],
                          true,
                        ),
                      ]
                    : []),
                ],
                `cases/${id}/action`,
                { version: data.version, action },
              )}
            <Table
              rows={list(data.compensations)}
              columns={columns(["number", "type", "status", "amountCents"])}
              select={(r) => router.push(href("compensations", r.id))}
            />
          </>
        )}
        {section === "compensations" && isNew && !!related.id && (
          <CompForm
            meta={meta}
            initial={{}}
            caseId={search.get("case") || ""}
            order={related}
            onSaved={saved}
          />
        )}
        {section === "compensations" && id && data && (
          <>
            <Facts
              data={{
                number: data.number,
                type: data.type,
                status: data.status,
                amount: money(data.amountCents),
                basis: data.basis,
                approvalNote: data.approvalNote,
                selfApproved: data.selfApproved
                  ? "Single-owner self-approval recorded"
                  : "No self-approval",
                dueAt: data.dueAt,
                result: data.result,
              }}
            />
            <p>
              <Link href={href("cases", data.caseId)}>Aftercare case</Link> ·{" "}
              <Link href={href("orders", data.orderId)}>Original order</Link>
            </p>
            {data.type === "COUPON" && (
              <p className={s.notice}>
                Coupon capability is not connected. No usable code will be
                generated and this request cannot be marked issued.
              </p>
            )}
            {data.expenseId && owner && (
              <Link
                href={"/admin/business?section=expenses&id=" + data.expenseId}
              >
                Same refund cash record in Expenses
              </Link>
            )}
            {data.replacement && <Facts data={obj(data.replacement)} />}{" "}
            {action === "EDIT" && related.id && (
              <CompForm
                meta={meta}
                initial={data}
                caseId={str(data.caseId)}
                order={related}
                onSaved={saved}
              />
            )}{" "}
            {action &&
              action !== "EDIT" &&
              form(
                "compensation " + action.toLowerCase(),
                [
                  occurred,
                  ...(action === "REFUND"
                    ? [
                        choose(
                          "source",
                          "Execution source",
                          ["MANUAL", "TEST"],
                          true,
                        ),
                        f(
                          "reference",
                          "Unique actual refund reference",
                          "text",
                          true,
                        ),
                        f("channel", "Actual payment channel", "text", true),
                        evidence,
                      ]
                    : []),
                  ...(action === "SHIP_REPLACEMENT"
                    ? [
                        f("carrier", "Carrier", "text", true),
                        f("trackingNumber", "Tracking number", "text", true),
                      ]
                    : []),
                  ...(action === "OTHER_COMPLETE" ? [evidence] : []),
                ],
                `compensations/${id}/action`,
                { version: data.version, action },
                {
                  source:
                    data.type && related.dataKind === "TEST"
                      ? "TEST"
                      : "MANUAL",
                },
              )}
          </>
        )}
        {id &&
          data &&
          ["orders", "cases", "compensations"].includes(section) && (
            <>
              {(section !== "orders" || owner) && (
                <Attachments
                  type={
                    section === "orders"
                      ? "order"
                      : section === "cases"
                        ? "case"
                        : "compensation"
                  }
                  id={id}
                />
              )}
              <button
                className={s.secondary}
                onClick={async () => {
                  try {
                    setProofs(
                      list(
                        (
                          await businessApi(
                            `attachments?objectType=${section === "orders" ? "order" : section === "cases" ? "case" : "compensation"}&objectId=${id}`,
                          )
                        ).items,
                      ),
                    );
                    setNotice("Evidence choices refreshed.");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Refresh evidence choices
              </button>
              <Timeline items={list(data.events)} />
            </>
          )}
        {section === "rules" && data && (
          <>
            <p>
              Rules start disabled until explicitly saved enabled. No public
              holiday calendar is downloaded. Day limits expire at the end of
              the target local day; pauses extend by elapsed time. Historical
              rule versions remain intact.
            </p>
            <Table
              rows={list(data.items)}
              columns={columns([
                "kind",
                "version",
                "enabled",
                "days",
                "dayMode",
                "timezone",
              ])}
              select={(r) => {
                setEditingRule(r);
                setAction("RULE");
              }}
            />
            <button
              className={s.button}
              onClick={() => {
                setEditingRule({});
                setAction("RULE");
              }}
            >
              New timeout rule
            </button>
            {action === "RULE" &&
              form(
                "timeout rule",
                [
                  choose(
                    "kind",
                    "Timer starts from",
                    [
                      "SHIPMENT",
                      "DELIVERY",
                      "FIRST_RESPONSE",
                      "CASE_RESOLUTION",
                      "COMPENSATION",
                    ],
                    true,
                  ),
                  f("enabled", "Enabled", "checkbox"),
                  f("days", "Days after start", "number", true),
                  choose(
                    "dayMode",
                    "Day counting",
                    ["CALENDAR", "BUSINESS"],
                    true,
                  ),
                  choose(
                    "timezone",
                    "Business timezone",
                    ["Australia/Melbourne", "Asia/Shanghai"],
                    true,
                  ),
                  {
                    ...f(
                      "weekends",
                      "Weekend days (0 Sunday, 6 Saturday)",
                      "multi",
                    ),
                    options: Array.from({ length: 7 }, (_, i) => ({
                      value: str(i),
                      label: str(i),
                    })),
                  },
                  f(
                    "holidays",
                    "Holiday dates, one YYYY-MM-DD per line",
                    "textarea",
                  ),
                  f("includeTest", "Include TEST orders", "checkbox"),
                  people(list(meta.people)),
                  {
                    ...people(list(meta.people), "recipientIds", "Recipients"),
                    type: "multi",
                  },
                  {
                    ...people(
                      list(meta.people),
                      "confirmerIds",
                      "Required confirmers",
                    ),
                    type: "multi",
                  },
                  f("severity", "Severity 0–3", "number", true),
                  f("pin", "Automatically pin exceptions", "checkbox"),
                  f(
                    "escalateDays",
                    "Escalate after extra natural days",
                    "number",
                    true,
                  ),
                  choose(
                    "apply",
                    "Apply rule change",
                    ["FUTURE", "RECALCULATE"],
                    true,
                  ),
                ],
                "rules",
                {
                  version: editingRule.version || 0,
                  shippingMethod: "STANDARD_AU",
                },
                {
                  kind: "SHIPMENT",
                  days: 2,
                  dayMode: "BUSINESS",
                  timezone: "Australia/Melbourne",
                  weekends: ["0", "6"],
                  assigneeId: obj(meta.actor).id,
                  recipientIds: [obj(meta.actor).id],
                  confirmerIds: [obj(meta.actor).id],
                  severity: 1,
                  pin: true,
                  escalateDays: 3,
                  apply: "FUTURE",
                  ...editingRule,
                  ...(editingRule.id
                    ? {
                        weekends: (editingRule.weekends as number[]).map(
                          String,
                        ),
                        holidays: (editingRule.holidays as string[]).join("\n"),
                      }
                    : {}),
                },
                (v) => ({
                  ...v,
                  weekends: ((v.weekends as string[]) || []).map(Number),
                  holidays: str(v.holidays)
                    .split(/[\s,]+/)
                    .filter(Boolean),
                }),
              )}
            <p>
              SHIPMENT starts at verified payment; DELIVERY at expected delivery
              date; FIRST_RESPONSE at reported issue time; CASE_RESOLUTION at
              the explicit case deadline; COMPENSATION at approved execution
              deadline. New rules do not silently revise existing timers.
              RECALCULATE explicitly applies a new version to active timers.
            </p>
          </>
        )}
        {section === "campaigns" &&
          (isNew || action === "CAMPAIGN") &&
          form(
            "Deals association",
            [
              f("name", "Campaign name", "text", true),
              f("startsAt", "Starts at", "datetime-local", true),
              f("endsAt", "Ends at", "datetime-local", true),
              {
                ...f("variantIds", "Associated SKUs", "multi", true),
                options: list(meta.skus).map((v) => ({
                  value: str(v.id),
                  label: str(v.sku),
                })),
              },
              f("active", "Enabled", "checkbox"),
              f("notes", "Association notes", "textarea"),
            ],
            "campaigns",
            !isNew ? { id: editingRule.id, version: editingRule.version } : {},
            { active: true, ...(!isNew ? editingRule : {}) },
          )}
      </main>
    </div>
  );
}
