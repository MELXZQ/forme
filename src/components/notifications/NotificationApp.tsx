"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "./client";
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
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [people, setPeople] = useState<string[]>([]),
    [assignee, setAssignee] = useState("");
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
        setReason("");
        setPeople([]);
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
  const act = async (action: string) => {
    if (!data) return;
    setBusy(true);
    try {
      await api(`item/${id}`, {
        key: crypto.randomUUID(),
        version: data.version,
        action,
        reason:
          reason ||
          (["ack"].includes(action)
            ? "Confirmed awareness of the current version"
            : ""),
        ...(["pin", "reassign"].includes(action)
          ? { confirmerIds: people }
          : {}),
        ...(action === "assign" ? { assigneeId: assignee } : {}),
      });
      setReason("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.root} data-admin>
      <nav className={s.nav}>
        <strong>FORME / NOTIFICATIONS</strong>
        <Link href="/admin/sales?section=home">My work / Orders & care</Link>
        <Link href="/admin/notifications">Today + pinned</Link>
        <Link href="/admin/notifications?view=all">All notifications</Link>
        <Link href="/admin/notifications?view=unfinished">
          Unfinished tasks
        </Link>
        <Link href="/admin/notifications?view=all&confirm=true">
          Awaiting my confirmation
        </Link>
        <Link href="/admin/notifications?view=all&mine=true">
          Assigned to me
        </Link>
        <Link href="/admin/operations">Stock / Orders</Link>
        <Link href="/admin/business">Purchases / Expenses / Logistics</Link>
        {owner && (
          <>
            <Link href="/admin?catalogue=1">Catalogue</Link>
            <Link href="/admin/notifications?view=rules">
              Rules / task status
            </Link>
          </>
        )}
        <button
          onClick={async () => {
            await fetch("/api/auth/sign-out", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            });
            router.replace("/admin/login");
          }}
        >
          Sign out
        </button>
      </nav>
      <main id="main" className={s.content}>
        <div className={s.heading}>
          <h1>
            {id
              ? "Notification"
              : view === "rules"
                ? "Notification rules"
                : "Notification centre"}
          </h1>
          <button
            className={s.secondary}
            onClick={() => void load()}
            disabled={busy}
          >
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
              <select
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
              </select>
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
                Date of first creation
                <input
                  type="date"
                  name="day"
                  defaultValue={params.get("day") || ""}
                />
              </label>
              <label>
                Type
                <select name="type" defaultValue={params.get("type") || ""}>
                  <option value="">All</option>
                  {types.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                Level
                <select
                  name="severity"
                  defaultValue={params.get("severity") || ""}
                >
                  <option value="">All</option>
                  {severity.map((v, i) => (
                    <option key={v} value={i}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select name="status" defaultValue={params.get("status") || ""}>
                  <option value="">All</option>
                  {["OPEN", "IN_PROGRESS", "RESOLVED", "NOT_APPLICABLE"].map(
                    (v) => (
                      <option key={v}>{v}</option>
                    ),
                  )}
                </select>
              </label>
              {owner && (
                <label>
                  Assignee
                  <select
                    name="assignee"
                    defaultValue={params.get("assignee") || ""}
                  >
                    <option value="">All</option>
                    {list(settings?.people).map((p) => (
                      <option key={str(p.id)} value={str(p.id)}>
                        {str(p.name)}
                      </option>
                    ))}
                  </select>
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
          <>
            <h2>{str(data.title)}</h2>
            <p>
              {severity[num(data.severity)]} · {str(data.status)} · Version{" "}
              {num(data.version)} · {data.pinned ? "Pinned" : "Not pinned"}
            </p>
            <p>{str(data.reason)}</p>
            <p>
              <strong>Suggested action:</strong> {str(data.action)}
            </p>
            <p>
              Occurred: {date(data.occurredAt)} · First generated:{" "}
              {date(data.createdAt)} · Updated: {date(data.updatedAt)} · Due:{" "}
              {date(data.deadlineAt)}
            </p>
            <Link href={str(data.link)}>Open related business record →</Link>
            <div className={s.split}>
              <div className={s.box}>
                <h2>At first trigger</h2>
                <Snapshot value={data.snapshot} />
              </div>
              <div className={s.box}>
                <h2>Latest checked data</h2>
                <Snapshot value={data.currentData} />
              </div>
            </div>
            <h2>Responsibility and confirmations</h2>
            <Table
              rows={list(data.people)}
              columns={[
                { key: "name", label: "Person" },
                {
                  key: "active",
                  label: "Account",
                  render: (r) => (r.active ? "Active" : "Inactive"),
                },
                {
                  key: "assignee",
                  label: "Responsibility",
                  render: (r) =>
                    r.id === data.assigneeId ? "Responsible" : "Recipient",
                },
                {
                  key: "confirmation",
                  label: "Current version",
                  render: (r) =>
                    Array.isArray(data.confirmerIds) &&
                    data.confirmerIds.includes(r.id)
                      ? list(data.receipts).some(
                          (a) =>
                            a.userId === r.id &&
                            a.version === data.version &&
                            a.kind === "ACK",
                        )
                        ? "Confirmed"
                        : "Awaiting confirmation"
                      : "Not required",
                },
              ]}
            />
            <p>
              Reading is personal. Confirmation acknowledges this version; it
              does not resolve the issue. Closed problems remain suppressed
              during the same continuous condition.
            </p>
            <div className={s.box}>
              <label>
                Outcome / internal note / reason
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className={s.actions}>
                <button
                  disabled={
                    busy ||
                    !(
                      Array.isArray(data.confirmerIds) &&
                      data.confirmerIds.includes(actor.id)
                    )
                  }
                  onClick={() => void act("ack")}
                >
                  Confirm current version
                </button>
                {(owner ||
                  (data.assigneeId === actor.id &&
                    actor.role === "warehouse")) && (
                  <>
                    <button
                      disabled={busy || reason.trim().length < 3}
                      onClick={() => void act("progress")}
                    >
                      Mark in progress
                    </button>
                    <button
                      disabled={busy || reason.trim().length < 3}
                      onClick={() => void act("note")}
                    >
                      Add internal note
                    </button>
                  </>
                )}
                {owner && (
                  <>
                    <button
                      disabled={busy || reason.trim().length < 3}
                      onClick={() => void act("resolve")}
                    >
                      Resolve with outcome
                    </button>
                    <button
                      disabled={busy || reason.trim().length < 3}
                      onClick={() => void act("dismiss")}
                    >
                      Close as not applicable
                    </button>
                    <button
                      disabled={busy || reason.trim().length < 3}
                      onClick={() => void act("unpin")}
                    >
                      Unpin after confirmations
                    </button>
                  </>
                )}
              </div>
              {owner && (
                <>
                  <label>
                    Responsible person
                    <select
                      value={assignee}
                      onChange={(e) => setAssignee(e.target.value)}
                    >
                      <option value="">Choose person</option>
                      {list(settings?.people).map((p) => (
                        <option value={str(p.id)} key={str(p.id)}>
                          {str(p.name)} · {str(p.role)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={busy || !assignee || reason.trim().length < 3}
                    onClick={() => void act("assign")}
                  >
                    Assign responsibility
                  </button>
                  <h3>Designated confirmers</h3>
                  {list(settings?.people).map((p) => (
                    <label className={s.field} key={str(p.id)}>
                      <span>
                        <input
                          type="checkbox"
                          checked={people.includes(str(p.id))}
                          onChange={(e) =>
                            setPeople(
                              e.target.checked
                                ? [...people, str(p.id)]
                                : people.filter((id) => id !== p.id),
                            )
                          }
                        />
                        {str(p.name)} · {str(p.role)}
                      </span>
                    </label>
                  ))}
                  <p>
                    Replacing the list is explicit, recorded, and creates a new
                    confirmation version. No one can confirm for another person.
                  </p>
                  <button
                    disabled={
                      busy || !people.length || reason.trim().length < 3
                    }
                    onClick={() => void act("pin")}
                  >
                    Pin with selected confirmers
                  </button>
                  <button
                    disabled={
                      busy || !people.length || reason.trim().length < 3
                    }
                    onClick={() => void act("reassign")}
                  >
                    Replace confirmer list with reason
                  </button>
                </>
              )}
            </div>
            <h2>History</h2>
            {list(data.history).map((h) => (
              <div className={s.receipt} key={str(h.id)}>
                <strong>{str(h.action)}</strong> · {date(h.createdAt)} ·{" "}
                {str(list(data.people).find((p) => p.id === h.actorId)?.name) ||
                  str(h.actorId)}
                <p>{str(h.reason)}</p>
                <details>
                  <summary>Recorded change</summary>
                  <pre style={{ whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(h.data, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
            <details>
              <summary>Version and confirmation history</summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {JSON.stringify(
                  { versions: data.revisions, receipts: data.receipts },
                  null,
                  2,
                )}
              </pre>
            </details>
          </>
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
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="FUTURE">
              Future additions only (retain existing included scope)
            </option>
            <option value="EXISTING">
              Include existing products — one grouped reminder
            </option>
          </select>
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
                <select
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
                </select>
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

function Snapshot({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>—</span>;
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((item, i) => (
          <li key={i}>
            <Snapshot value={item} />
          </li>
        ))}
      </ul>
    );
  if (typeof value === "object")
    return (
      <dl>
        {Object.entries(value).map(([key, item]) => (
          <div key={key} style={{ marginBottom: 12, overflowWrap: "anywhere" }}>
            <dt>
              <strong>
                {key
                  .replace(/([a-z])([A-Z])/g, "$1 $2")
                  .replace(/^./, (c) => c.toUpperCase())}
              </strong>
            </dt>
            <dd style={{ marginLeft: 12 }}>
              <Snapshot value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <span>{String(value)}</span>;
}
