"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Select } from "@/components/ui/Select";
import {
  canConfigure,
  MAX_WIDGETS,
  newWidget,
  type HomeMeta,
  type HomePayload,
  type HomeResult,
  type Widget,
  type WidgetSize,
} from "@/lib/home-layout";
import { NotificationDrawer } from "@/components/notifications/NotificationDrawer";
import s from "./Home.module.css";

class HomeError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(
  path = "",
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch("/api/home" + path, {
    method: body === undefined ? "GET" : method,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new HomeError(
      data.error || "Home is unavailable. Please retry.",
      response.status,
    );
  return data.data;
}
const amount = (value: number, currency: string) =>
  `${currency} ${new Intl.NumberFormat("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100)}`;
const nameOf = (meta: HomeMeta, widget: Widget) =>
  meta.catalogue.find((d) => d.type === widget.type)?.name || widget.type;

function Contents({
  data,
  zone,
  openNotification,
}: {
  data: HomePayload;
  zone: string;
  openNotification: (id: string) => void;
}) {
  const notices = data.notifications;
  const max = Math.max(1, ...(data.trend || []).map((p) => p.value ?? 0));
  return (
    <>
      {!!data.metrics.length && (
        <div className={s.metrics}>
          {data.metrics.map((m) => (
            <Link
              key={m.key}
              href={m.href}
              className={m.attention ? s.attention : undefined}
            >
              <span className={s.metricLabel}>
                {m.label}
                <span aria-hidden="true">↗</span>
              </span>
              <strong className={m.emptyLabel ? s.emptyMetric : undefined}>
                {m.value === null
                  ? m.emptyLabel || "—"
                  : m.currency
                    ? amount(m.value, m.currency)
                    : m.value.toLocaleString("en-AU")}
              </strong>
              {m.unit && <small>{m.unit}</small>}
            </Link>
          ))}
        </div>
      )}
      {data.trend && (
        <>
          <div
            className={s.chart}
            aria-label="Daily paid merchandise; select a date for details"
          >
            {data.trend.map((p) => (
              <Link
                key={p.day}
                href={p.href}
                aria-label={`${p.day}: ${p.value === null ? "no recorded payments" : amount(p.value, "AUD")}, ${p.orders} orders`}
              >
                <span className={s.barTrack}>
                  <span
                    className={p.value === null ? s.gap : s.bar}
                    style={{
                      height:
                        p.value === null
                          ? "3px"
                          : `${Math.max(2, (p.value / max) * 100)}%`,
                    }}
                  />
                </span>
                <span>{p.day.slice(8)}</span>
              </Link>
            ))}
          </div>
          <details className={s.dataTable}>
            <summary>Daily values</summary>
            <table>
              <caption>Recorded payments by calendar day</caption>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Merchandise</th>
                  <th>Orders</th>
                </tr>
              </thead>
              <tbody>
                {data.trend.map((p) => (
                  <tr key={p.day}>
                    <td>
                      <Link href={p.href}>{p.day}</Link>
                    </td>
                    <td>
                      {p.value === null
                        ? "No recorded payments"
                        : amount(p.value, "AUD")}
                    </td>
                    <td>{p.orders || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
      {notices && (
        <>
          <div className={s.noticeCount}>
            <span>{notices.total} total</span>
            <strong>{notices.hiddenPinned} pinned not shown</strong>
            <Link href={notices.href}>View all ↗</Link>
          </div>
          <div className={s.notices}>
            {notices.items.map((n) => (
              <button
                key={n.id}
                onClick={() => openNotification(n.id)}
                className={s.noticeItem}
              >
                <span className={s.noticeMeta}>
                  <span className={n.severity >= 2 ? s.alertBadge : s.badge}>
                    {["Information", "Task", "Warning", "Critical"][n.severity]}{" "}
                    · {n.type.toLowerCase()}
                  </span>
                  {n.pinned && <span className={s.pin}>Pinned</span>}
                </span>
                <strong>{n.title}</strong>
                <span className={s.reason}>{n.reason}</span>
                <span className={s.noticeMeta}>
                  {n.assignee} · {n.confirmed}/{n.required} confirmed{" "}
                  <time dateTime={n.createdAt}>
                    {new Date(n.createdAt).toLocaleString("en-AU", {
                      timeZone: zone,
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {data.empty && <p className={s.empty}>{data.empty}</p>}
      {data.incomplete && <p className={s.warning}>{data.incomplete}</p>}
      <details className={s.basis}>
        <summary>What this includes</summary>
        <p className={s.note}>{data.note}</p>
      </details>
    </>
  );
}

export function HomeApp() {
  const [meta, setMeta] = useState<HomeMeta | null>(null);
  const [results, setResults] = useState<Record<string, HomeResult>>({});
  const [loading, setLoading] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState<{
    revision: number;
    widgets: Widget[];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [noticeId, setNoticeId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const version = useRef(0),
    lastRefresh = useRef(0),
    draftRef = useRef(draft);
  const cacheKeys = useRef<Record<string, string>>({});
  const invalidate = useCallback(() => {
    version.current++;
  }, []);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const refresh = useCallback(async (only?: string) => {
    const generation = ++version.current;
    lastRefresh.current = Date.now();
    try {
      const current = await request<HomeMeta>();
      if (generation !== version.current) return;
      setMeta(current);
      setError("");
      const editing = draftRef.current;
      const widgets = (editing?.widgets || current.widgets).filter((w) =>
        canConfigure(current.actor, w),
      );
      if (editing)
        setDraft((d) =>
          d
            ? {
                ...d,
                widgets: d.widgets.filter((w) =>
                  canConfigure(current.actor, w),
                ),
              }
            : d,
        );
      const allowedIds = new Set(widgets.map((w) => w.id));
      const previousKeys = cacheKeys.current;
      const nextKeys = Object.fromEntries(
        widgets.map((w) => [
          w.id,
          JSON.stringify([
            w.type,
            w.config,
            w.size,
            current.timezone,
            current.actor.role,
            [...(current.actor.capabilities || [])].sort(),
          ]),
        ]),
      );
      cacheKeys.current = nextKeys;
      setResults((old) =>
        Object.fromEntries(
          Object.entries(old).filter(
            ([id]) => allowedIds.has(id) && previousKeys[id] === nextKeys[id],
          ),
        ),
      );
      const requested = only ? widgets.filter((w) => w.id === only) : widgets;
      if (!requested.length) {
        setLoading([]);
        return;
      }
      setLoading(requested.map((w) => w.id));
      const response = await request<{ meta: HomeMeta; results: HomeResult[] }>(
        "/data",
        { widgets: requested },
      );
      if (generation !== version.current) return;
      // A revoked permission never retains a previously rendered financial value.
      setResults((old) => {
        const next = { ...old };
        for (const result of response.results)
          next[result.id] =
            result.status === "error" && old[result.id]?.data
              ? { ...old[result.id], status: "error", error: result.error }
              : result;
        return next;
      });
    } catch (e) {
      if (generation !== version.current) return;
      const failure = e as HomeError;
      setError(failure.message);
      if ([401, 403].includes(failure.status)) {
        setResults({});
        setMeta(null);
        setDraft(null);
      } else
        setResults((old) =>
          Object.fromEntries(
            Object.entries(old).map(([id, value]) => [
              id,
              {
                ...value,
                status: "error",
                error:
                  "Refresh failed. Previously loaded data may be out of date.",
              },
            ]),
          ),
        );
    } finally {
      if (generation === version.current) setLoading([]);
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) void refresh();
    });
    const visibleRefresh = () => {
      if (!document.hidden && Date.now() - lastRefresh.current > 30000)
        void refresh();
    };
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 120000);
    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("forme-admin");
    if (channel)
      channel.onmessage = () => {
        if (!document.hidden) void refresh();
        else lastRefresh.current = 0;
      };
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      mounted = false;
      invalidate();
      clearInterval(timer);
      channel?.close();
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [refresh, invalidate]);
  const widgets = draft?.widgets || meta?.widgets || [];
  const change = (id: string, transform: (w: Widget) => Widget) => {
    invalidate();
    setLoading([]);
    setDraft((d) =>
      d
        ? {
            ...d,
            widgets: d.widgets.map((w) => (w.id === id ? transform(w) : w)),
          }
        : d,
    );
    setResults((old) => {
      const copy = { ...old };
      delete copy[id];
      return copy;
    });
  };
  const focusWidget = (id: string) =>
    requestAnimationFrame(() => document.getElementById(`move-${id}`)?.focus());
  const move = (id: string, index: number) => {
    if (!draft || !meta) return;
    const copy = [...draft.widgets],
      from = copy.findIndex((w) => w.id === id);
    if (from < 0 || index < 0 || index >= copy.length) return;
    const [item] = copy.splice(from, 1);
    copy.splice(index, 0, item);
    setDraft({ ...draft, widgets: copy });
    setMessage(`${nameOf(meta, item)} moved to position ${index + 1}.`);
    focusWidget(id);
  };
  const save = async () => {
    if (!draft || !meta) return;
    setSaving(true);
    setError("");
    try {
      const saved = await request<HomeMeta>(
        "",
        { version: meta.version, ...draft },
        "PUT",
      );
      setMeta(saved);
      setDraft(null);
      draftRef.current = null;
      setMessage("Your Home layout is saved to your account.");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <main id="main" data-admin className={s.root}>
      <header className={s.heading}>
        <div>
          <p className={s.eyebrow}>YOUR WORKSPACE</p>
          <h1>Home</h1>
          <p className={s.date}>
            {meta ? (
              <>
                <time dateTime={meta.today}>
                  {new Date(meta.now).toLocaleDateString("en-AU", {
                    timeZone: meta.timezone,
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </time>
                <span>
                  {meta.timezone} ·{" "}
                  {
                    new Intl.DateTimeFormat("en-AU", {
                      timeZone: meta.timezone,
                      timeZoneName: "longOffset",
                    })
                      .formatToParts(new Date(meta.now))
                      .find((p) => p.type === "timeZoneName")?.value
                  }
                </span>
              </>
            ) : (
              "Loading your workspace…"
            )}
          </p>
        </div>
        <div className={s.actions}>
          <button onClick={() => void refresh()} disabled={!!loading.length}>
            ↻ {loading.length ? "Refreshing…" : "Refresh"}
          </button>
          <button
            className={s.primary}
            disabled={!meta || !!draft}
            onClick={() => {
              if (meta) {
                setDraft({
                  revision: meta.revision,
                  widgets: structuredClone(meta.widgets),
                });
                setMessage("Editing your layout. Changes are not saved yet.");
              }
            }}
          >
            Customise layout
          </button>
        </div>
      </header>
      {meta && (
        <div className={meta.testWorkspace ? s.testBanner : s.scope}>
          <strong>
            {meta.testWorkspace
              ? "TEST WORKSPACE — isolated sample database"
              : "Local workspace"}
          </strong>
          <span>
            REAL record scope · test / unverified sales excluded. Stock and
            unmarked manual records belong to this workspace.
          </span>
          <Link href="/admin/notifications">Timezone & notifications ↗</Link>
        </div>
      )}
      {error && (
        <div className={s.error} role="alert">
          {error} <button onClick={() => void refresh()}>Retry Home</button>
          {!meta && <Link href="/admin/login">Sign in</Link>}
        </div>
      )}
      <p
        role="status"
        aria-live="polite"
        className={message ? s.feedback : "sr-only"}
      >
        {message}
      </p>
      {meta?.recovered && (
        <p className={s.warning}>
          An older layout or changed permission was safely adjusted. Save a
          customised layout to keep this version.
        </p>
      )}
      {!meta && !error && (
        <div className={s.skeletons} aria-label="Loading Home">
          <span />
          <span />
          <span />
        </div>
      )}
      {draft && meta && (
        <section className={s.editor} aria-label="Layout editor">
          <div className={s.editorTop}>
            <div>
              <h2>Make Home yours</h2>
              <p>
                Drag a handle on desktop, or use Move up / Move down. Preview
                data can refresh while your edits stay in place.
              </p>
            </div>
            <div className={s.actions}>
              <button
                onClick={() => {
                  invalidate();
                  setLoading([]);
                  setResults({});
                  setDraft({
                    ...draft,
                    widgets: structuredClone(meta.defaults),
                  });
                  setMessage(
                    "Default layout restored in the editor. Save to keep it, or Cancel to undo.",
                  );
                }}
              >
                Restore defaults
              </button>
              <button
                disabled={saving}
                onClick={() => {
                  setDraft(null);
                  draftRef.current = null;
                  setMessage(
                    "Edits cancelled. Your saved layout is unchanged.",
                  );
                  void refresh();
                }}
              >
                Cancel
              </button>
              <button
                className={s.primary}
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save layout"}
              </button>
            </div>
          </div>
          <details className={s.catalogue}>
            <summary>
              Add widgets · {draft.widgets.length}/{MAX_WIDGETS}
            </summary>
            <div>
              {meta.catalogue.map((definition) => {
                const disabled =
                  draft.widgets.length >= MAX_WIDGETS ||
                  (!definition.repeat &&
                    draft.widgets.some((w) => w.type === definition.type));
                return (
                  <article key={definition.type}>
                    <div className={s.preview} aria-label="Layout preview">
                      {definition.preview}
                    </div>
                    <h3>{definition.name}</h3>
                    <p>{definition.description}</p>
                    <button
                      disabled={disabled}
                      onClick={() => {
                        const widget = newWidget(
                          definition.type,
                          crypto.randomUUID(),
                        );
                        setDraft({
                          ...draft,
                          widgets: [...draft.widgets, widget],
                        });
                        setMessage(
                          `${definition.name} added. Save to keep it.`,
                        );
                        focusWidget(widget.id);
                      }}
                    >
                      {" "}
                      {disabled &&
                      draft.widgets.some((w) => w.type === definition.type) &&
                      !definition.repeat
                        ? "Added"
                        : `Add ${definition.name}`}
                    </button>
                  </article>
                );
              })}
            </div>
          </details>
        </section>
      )}
      {meta && (
        <div className={s.grid}>
          {widgets.map((widget, index) => {
            const definition = meta.catalogue.find(
              (d) => d.type === widget.type,
            );
            if (!definition) return null;
            const result = results[widget.id],
              busy = loading.includes(widget.id);
            return (
              <section
                key={widget.id}
                className={`${s.card} ${s[widget.size]} ${draft ? s.editing : ""} ${dragging === widget.id ? s.dragging : ""}`}
                aria-labelledby={`title-${widget.id}`}
                data-widget={widget.type}
                data-instance={widget.id}
                onDragOver={(e) => {
                  if (draft && dragging) e.preventDefault();
                }}
                onDrop={(e) => {
                  if (draft && dragging) {
                    e.preventDefault();
                    move(dragging, index);
                    setDragging(null);
                  }
                }}
              >
                <div className={s.cardHeading}>
                  <h2 id={`title-${widget.id}`}>{definition.name}</h2>
                  {definition.core && draft && (
                    <span className={s.badge}>Required</span>
                  )}
                  {!draft && (
                    <button
                      className={s.retry}
                      disabled={busy}
                      aria-label={`Refresh ${definition.name}`}
                      onClick={() => void refresh(widget.id)}
                    >
                      ↻
                    </button>
                  )}
                </div>
                {widget.type === "sales" && (
                  <p className={s.context}>
                    After discounts · before refunds · shipping excluded
                  </p>
                )}
                {widget.type === "trend" && (
                  <p className={s.context}>
                    7 calendar days · includes today, still in progress
                  </p>
                )}
                {widget.type === "inventory" && (
                  <p className={s.context}>
                    Zero available includes alerts-off SKUs; counts can overlap.
                  </p>
                )}
                {widget.type === "expenses" && (
                  <p className={s.context}>
                    Next 7 days excludes today · currencies kept separate
                  </p>
                )}
                {draft && (
                  <div className={s.widgetEditor}>
                    <div className={s.reorder}>
                      <button
                        id={`move-${widget.id}`}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", widget.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragging(widget.id);
                        }}
                        onDragEnd={() => setDragging(null)}
                        aria-label={`Drag ${definition.name}, position ${index + 1}`}
                      >
                        ⠿ <span>Move</span>
                      </button>
                      <button
                        disabled={index === 0}
                        aria-label={`Move ${definition.name} up`}
                        onClick={() => move(widget.id, index - 1)}
                      >
                        ↑
                      </button>
                      <button
                        disabled={index === widgets.length - 1}
                        aria-label={`Move ${definition.name} down`}
                        onClick={() => move(widget.id, index + 1)}
                      >
                        ↓
                      </button>
                      {!definition.core && (
                        <button
                          aria-label={`Remove ${definition.name}`}
                          onClick={() => {
                            setDraft({
                              ...draft,
                              widgets: draft.widgets.filter(
                                (w) => w.id !== widget.id,
                              ),
                            });
                            setMessage(
                              `${definition.name} removed. Save to keep it, or Cancel to undo.`,
                            );
                            const next =
                              widgets[index + 1] || widgets[index - 1];
                            if (next) focusWidget(next.id);
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <label>
                      Size
                      <Select
                        aria-label={`${definition.name} size`}
                        value={widget.size}
                        onChange={(e) =>
                          change(widget.id, (w) => ({
                            ...w,
                            size: e.target.value as WidgetSize,
                          }))
                        }
                      >
                        {definition.sizes.map((size) => (
                          <option value={size} key={size}>
                            {size[0].toUpperCase() + size.slice(1)}
                          </option>
                        ))}
                      </Select>
                    </label>
                    {widget.type === "inventory" && (
                      <label>
                        Warehouse
                        <Select
                          aria-label={`Warehouse for ${widget.id}`}
                          value={widget.config.warehouse}
                          onChange={(e) =>
                            change(
                              widget.id,
                              (w) =>
                                ({
                                  ...w,
                                  config: { warehouse: e.target.value },
                                }) as Widget,
                            )
                          }
                        >
                          <option value="MELBOURNE">Melbourne</option>
                          {meta.actor.role === "admin" && (
                            <>
                              <option value="BEIJING">Beijing</option>
                              <option value="BOTH">Both warehouses</option>
                            </>
                          )}
                        </Select>
                      </label>
                    )}
                    {widget.type === "logistics" && (
                      <label>
                        Transport type
                        <Select
                          aria-label="Parcel activity transport type"
                          value={widget.config.type}
                          onChange={(e) =>
                            change(
                              widget.id,
                              (w) =>
                                ({
                                  ...w,
                                  config: { type: e.target.value },
                                }) as Widget,
                            )
                          }
                        >
                          {[
                            "ALL",
                            "SUPPLIER_INBOUND",
                            "TRANSFER",
                            "CUSTOMER_DELIVERY",
                            "CUSTOMER_RETURN",
                            "REPLACEMENT",
                            "SUPPLIER_RETURN",
                            "OTHER",
                          ].map((type) => (
                            <option key={type} value={type}>
                              {type.replaceAll("_", " ")}
                            </option>
                          ))}
                        </Select>
                      </label>
                    )}
                  </div>
                )}
                <div
                  className={draft ? s.editPreview : undefined}
                  inert={!!draft}
                >
                  {busy && (
                    <p className={s.loading} role="status">
                      Updating…
                    </p>
                  )}
                  {result?.status === "error" && (
                    <div className={s.error} role="alert">
                      {result.error}
                      {result.data && (
                        <strong>
                          {" "}
                          Showing the last successful result; it may be out of
                          date.
                        </strong>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => void refresh(widget.id)}
                      >
                        Retry {definition.name}
                      </button>
                    </div>
                  )}
                  {result?.status === "forbidden" && (
                    <p className={s.warning}>
                      Permission is no longer available. Refresh Home to update
                      the layout.
                    </p>
                  )}
                  {result?.data && (
                    <Contents
                      data={result.data}
                      zone={meta.timezone}
                      openNotification={setNoticeId}
                    />
                  )}
                  {!result && !busy && (
                    <p className={s.empty}>
                      {draft
                        ? "Save the layout or refresh to load this widget."
                        : "Waiting for this widget’s data…"}
                    </p>
                  )}
                  {result?.updatedAt && (
                    <p className={s.updated}>
                      Last successful update{" "}
                      <time dateTime={result.updatedAt}>
                        {new Date(result.updatedAt).toLocaleTimeString(
                          "en-AU",
                          {
                            timeZone: meta.timezone,
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </time>
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {noticeId && meta && (
        <NotificationDrawer
          id={noticeId}
          actor={meta.actor}
          onClose={() => setNoticeId(null)}
          onChanged={() => void refresh()}
        />
      )}
    </main>
  );
}
