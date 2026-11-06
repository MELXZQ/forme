"use client";
import { Select } from "@/components/ui/Select";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "./client";
import { NotificationDetail } from "./NotificationDetail";
import { ProductChecks } from "./StockTools";
import { obj, list, str, num, Table, type Row } from "../operations/ui";
import s from "../operations/Operations.module.css";
const types = [
  "INVENTORY",
  "PRODUCT",
  "LOGISTICS",
  "SYSTEM",
  "PROCUREMENT",
  "FINANCE",
  "ORDER",
];
const severity = ["Information", "Task", "Warning", "Critical"];
export function NotificationApp({
  actor,
}: {
  actor: { id: string; role: string };
}) {
  const params = useSearchParams(),
    router = useRouter();
  const query = params.toString(),
    id = params.get("id"),
    view = params.get("view") || "today",
    owner = actor.role === "admin";
  const [data, setData] = useState<Row | null>(null),
    [settings, setSettings] = useState<Row | null>(null),
    [error, setError] = useState("");
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const d =
        view === "rules"
          ? await api("rules")
          : await api(id ? `item/${id}` : `?${query}`);
      const rules = owner ? (view === "rules" ? d : await api("rules")) : null;
      if (current !== generation.current) return;
      setData(d);
      if (rules) setSettings(rules);
      setError("");
      if (id)
        await api(`item/${id}`, {
          key: crypto.randomUUID(),
          action: "read",
          reason: "Opened notification detail",
          version: d.version,
        });
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    }
  }, [view, id, query, owner]);
  useEffect(() => {
    let stopped = false;
    const invalidate = () => {
      generation.current++;
    };
    queueMicrotask(() => {
      if (!stopped) {
        setData(null);
        void load();
      }
    });
    return () => {
      stopped = true;
      invalidate();
    };
  }, [load]);
  const zone = str(data?.timezone) || "Australia/Melbourne";
  const date = (value: unknown) =>
    value
      ? new Date(str(value)).toLocaleString("en-AU", { timeZone: zone })
      : "—";

  return (
    <div className={s.root} data-admin>
      <main id="main" className={s.content}>
        <div className={s.heading}>
          <h1>
            {id
              ? "Notification"
              : view === "rules"
                ? "Notification rules"
                : "Notification centre"}
          </h1>
          <button className={s.secondary} onClick={() => void load()}>
            Refresh
          </button>
        </div>
        <p className={s.notice}>
          Local reminders are checked by the background task. While this Mac or
          the task is stopped, reminders cannot update in real time. Refresh
          does not discard your note; no background polling changes a form you
          are editing.
        </p>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        {!data && !error && <p role="status">Loading notifications…</p>}
        {data && view === "rules" && owner && (
          <Rules data={data} onSaved={load} />
        )}
        {data && view !== "rules" && !id && (
          <>
            <p>
              <Link href="/admin/notifications?view=unfinished">
                {num(data.unfinished)} unfinished actionable tasks
              </Link>{" "}
              · Information-only updates are excluded.
            </p>
            <label>
              My timezone
              <Select
                aria-label="My timezone"
                value={zone}
                onChange={async (e) => {
                  try {
                    await api("preference", { timezone: e.target.value });
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <option value="Australia/Melbourne">
                  Melbourne (daylight saving aware)
                </option>
                <option value="Asia/Shanghai">Beijing</option>
              </Select>
            </label>
            <form
              key={query}
              className={s.filters}
              onSubmit={(e) => {
                e.preventDefault();
                const next = new URLSearchParams();
                for (const [k, v] of new FormData(e.currentTarget))
                  if (String(v)) next.set(k, String(v));
                router.push("/admin/notifications?" + next);
              }}
            >
              <input type="hidden" name="view" value={view} />
              <label>
                Record scope
                <Select
                  aria-label="Notification record scope"
                  name="dataKind"
                  defaultValue={params.get("dataKind") || ""}
                >
                  <option value="">All</option>
                  <option value="REAL">REAL</option>
                  <option value="TEST">TEST</option>
                </Select>
              </label>
              {params.get("objectType") && (
                <input
                  type="hidden"
                  name="objectType"
                  value={params.get("objectType")!}
                />
              )}
              <label>
                Date of first creation
                <input
                  type="date"
                  name="day"
                  defaultValue={params.get("day") || ""}
                />
              </label>
              <label>
                Type
                <Select
                  aria-label="Type"
                  name="type"
                  defaultValue={params.get("type") || ""}
                >
                  <option value="">All</option>
                  {types.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
              </label>
              <label>
                Level
                <Select
                  aria-label="Level"
                  name="severity"
                  defaultValue={params.get("severity") || ""}
                >
                  <option value="">All</option>
                  {severity.map((v, i) => (
                    <option key={v} value={i}>
                      {v}
                    </option>
                  ))}
                </Select>
              </label>
              <label>
                Status
                <Select
                  aria-label="Status"
                  name="status"
                  defaultValue={params.get("status") || ""}
                >
                  <option value="">All</option>
                  {["OPEN", "IN_PROGRESS", "RESOLVED", "NOT_APPLICABLE"].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </Select>
              </label>
              {owner && (
                <label>
                  Assignee
                  <Select
                    aria-label="Assignee"
                    name="assignee"
                    defaultValue={params.get("assignee") || ""}
                  >
                    <option value="">All</option>
                    {list(settings?.people).map((p) => (
                      <option key={str(p.id)} value={str(p.id)}>
                        {str(p.name)}
                      </option>
                    ))}
                  </Select>
                </label>
              )}
              {["mine", "confirm", "unread", "pinned"].map((k) => (
                <label key={k}>
                  <span>
                    <input
                      name={k}
                      type="checkbox"
                      value="true"
                      defaultChecked={params.get(k) === "true"}
                    />
                    {
                      {
                        mine: "Assigned to me",
                        confirm: "Awaiting my confirmation",
                        unread: "Unread",
                        pinned: "Pinned",
                      }[k as "mine"]
                    }
                  </span>
                </label>
              ))}
              <button className={s.button}>Filter notifications</button>
            </form>
            <Table
              rows={list(data.items)}
              columns={[
                {
                  key: "pinned",
                  label: "Pinned",
                  render: (r) => (r.pinned ? "Pinned" : "—"),
                },
                {
                  key: "severity",
                  label: "Level",
                  render: (r) => severity[num(r.severity)],
                },
                { key: "title", label: "Notification" },
                { key: "status", label: "Status" },
                {
                  key: "unread",
                  label: "Unread",
                  render: (r) => (r.unread ? "Unread" : "Read"),
                },
                {
                  key: "needsConfirmation",
                  label: "My confirmation",
                  render: (r) => (r.needsConfirmation ? "Required" : "—"),
                },
                {
                  key: "createdAt",
                  label: "First generated",
                  render: (r) => date(r.createdAt),
                },
              ]}
              select={(r) => router.push(`/admin/notifications?id=${r.id}`)}
            />
            <p>
              Page {num(data.page)} / {num(data.pageCount)} · {num(data.total)}{" "}
              records
            </p>
            {[-1, 1].map((delta) => (
              <button
                className={s.secondary}
                key={delta}
                disabled={
                  num(data.page) + delta < 1 ||
                  num(data.page) + delta > num(data.pageCount)
                }
                onClick={() => {
                  const p = new URLSearchParams(params);
                  p.set("page", String(num(data.page) + delta));
                  router.push("/admin/notifications?" + p);
                }}
              >
                {delta < 0 ? "Previous" : "Next"}
              </button>
            ))}
          </>
        )}
        {data && id && (
          <NotificationDetail
            key={id}
            data={data}
            actor={actor}
            settings={settings}
            reload={load}
          />
        )}
      </main>
    </div>
  );
}
function Rules({ data, onSaved }: { data: Row; onSaved: () => Promise<void> }) {
  const rules = obj(data.rules),
    people = list(data.people);
  const [values, setValues] = useState<Row>(rules),
    [scope, setScope] = useState("FUTURE"),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const update = (key: string, value: unknown) =>
    setValues((v) => ({ ...v, [key]: value }));
  const [routes, setRoutes] = useState<Row>(obj(rules.routing));
  return (
    <>
      <form
        className={s.box}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("rules", {
              key: crypto.randomUUID(),
              reason,
              beijingThreshold: values.beijingThreshold ?? null,
              melbourneThreshold: values.melbourneThreshold ?? null,
              productEnabled: !!values.productEnabled,
              productNewDefault: !!values.productNewDefault,
              productScope: scope,
              overdueGraceDays: num(values.overdueGraceDays),
              autoPinOutOfStock: !!values.autoPinOutOfStock,
              routing: routes,
            });
            setMessage("Rules saved. Run a check or wait for the local task.");
            await onSaved();
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>Warehouse defaults</h2>
        <p>
          Changing defaults affects inherited SKUs only. Blank means off; 0
          means out-of-stock alerts only.
        </p>
        <div className={s.grid}>
          {["beijingThreshold", "melbourneThreshold"].map((k) => (
            <label key={k}>
              {k === "beijingThreshold" ? "Beijing" : "Melbourne"} default
              <input
                type="number"
                min="0"
                max="1000000"
                value={values[k] === null ? "" : str(values[k])}
                onChange={(e) =>
                  update(
                    k,
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </label>
          ))}
        </div>
        <h2>Product information</h2>
        {[
          ["productEnabled", "Enable product information checks"],
          ["productNewDefault", "New / included products inherit checks"],
        ].map(([k, label]) => (
          <label className={s.field} key={k}>
            <span>
              <input
                type="checkbox"
                checked={!!values[k]}
                onChange={(e) => update(k, e.target.checked)}
              />
              {label}
            </span>
          </label>
        ))}
        <label>
          Scope when enabling
          <Select
            aria-label="Scope when enabling"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="FUTURE">
              Future additions only (retain existing included scope)
            </option>
            <option value="EXISTING">
              Include existing products — one grouped reminder
            </option>
          </Select>
        </label>
        <h2>Transport and priority</h2>
        <label>
          Arrival grace days
          <input
            type="number"
            min="0"
            max="90"
            value={num(values.overdueGraceDays)}
            onChange={(e) => update("overdueGraceDays", Number(e.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={!!values.autoPinOutOfStock}
            onChange={(e) => update("autoPinOutOfStock", e.target.checked)}
          />
          Auto-pin complete stockouts
        </label>
        <h2>Default people by notification type</h2>
        <p>
          If unset, the unique active Owner is used. With multiple owners choose
          explicitly. Inventory defaults must have access to Beijing as well as
          Melbourne; individual Melbourne notifications can later be assigned to
          an authorized warehouse account.
        </p>
        {types.map((type) => {
          const r = obj(routes[type]);
          return (
            <fieldset key={type}>
              <legend>{type}</legend>
              <label>
                Responsible person
                <Select
                  aria-label={`${type} responsible person`}
                  value={str(r.assigneeId)}
                  onChange={(e) => {
                    if (!e.target.value) {
                      const next = { ...routes };
                      delete next[type];
                      setRoutes(next);
                    } else
                      setRoutes({
                        ...routes,
                        [type]: {
                          assigneeId: e.target.value,
                          recipientIds: [e.target.value],
                          confirmerIds: [e.target.value],
                        },
                      });
                  }}
                >
                  <option value="">Unique active Owner</option>
                  {people.map((p) => (
                    <option key={str(p.id)} value={str(p.id)}>
                      {str(p.name)} · {str(p.role)}
                    </option>
                  ))}
                </Select>
              </label>
              {!!r.assigneeId &&
                ["recipientIds", "confirmerIds"].map((k) => (
                  <div key={k}>
                    <p>
                      {k === "recipientIds"
                        ? "Recipients"
                        : "Required confirmers"}
                    </p>
                    {people.map((p) => (
                      <label key={str(p.id)}>
                        <input
                          type="checkbox"
                          checked={Array.isArray(r[k]) && r[k].includes(p.id)}
                          onChange={(e) => {
                            const ids = Array.isArray(r[k])
                              ? (r[k] as string[])
                              : [];
                            setRoutes({
                              ...routes,
                              [type]: {
                                ...r,
                                [k]: e.target.checked
                                  ? [...ids, str(p.id)]
                                  : ids.filter((id) => id !== p.id),
                              },
                            });
                          }}
                        />
                        {str(p.name)}{" "}
                      </label>
                    ))}
                  </div>
                ))}
            </fieldset>
          );
        })}
        <label>
          Reason
          <input
            required
            minLength={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button className={s.button} disabled={busy}>
          Save notification rules
        </button>
      </form>
      <ProductChecks />
      <div className={s.box}>
        <h2>Background task status</h2>
        <p>
          <strong>{str(obj(data.job).state)}</strong>
        </p>
        <p>
          Last successful check:{" "}
          {str(obj(data.job).lastSuccessAt) || "Not run yet"}
        </p>
        <p>
          Pending change version: {str(obj(data.job).requested)} / completed{" "}
          {str(obj(data.job).completed)}
        </p>
        {!!obj(data.job).lastError && (
          <p className={s.error}>{str(obj(data.job).lastError)}</p>
        )}
        <button
          disabled={busy}
          className={s.button}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await api("check", {});
              setMessage(
                result.busy
                  ? "Another check is already running."
                  : "Check completed.",
              );
              await onSaved();
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Run check now
        </button>
        <p>
          Run npm run notifications:worker locally. It checks persisted changes
          and overdue dates without opening this page.
        </p>
        <Table
          rows={list(data.runs)}
          columns={[
            { key: "finishedAt", label: "Finished (UTC)" },
            {
              key: "success",
              label: "Success",
              render: (r) => (r.success ? "Yes" : "Failed"),
            },
            { key: "checked", label: "Conditions" },
            { key: "error", label: "Sanitized error" },
          ]}
        />
      </div>
      {message && (
        <p role="status" className={s.notice}>
          {message}
        </p>
      )}
    </>
  );
}
