"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "./client";
import type { Row } from "../operations/ui";
import { NotificationDetail } from "./NotificationDetail";
import operations from "../operations/Operations.module.css";
import s from "./NotificationDrawer.module.css";

export function NotificationDrawer({
  id,
  actor,
  onClose,
  onChanged,
}: {
  id: string;
  actor: { id: string; role: string };
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<Row | null>(null),
    [settings, setSettings] = useState<Row | null>(null),
    [error, setError] = useState("");
  const callbacks = useRef({ onChanged, onClose });
  useEffect(() => {
    callbacks.current = { onChanged, onClose };
  }, [onChanged, onClose]);
  const load = useCallback(async () => {
    try {
      const detail = await api(`item/${id}`);
      setData(detail);
      setError("");
      await api(`item/${id}`, {
        key: crypto.randomUUID(),
        action: "read",
        version: detail.version,
        reason: "Opened notification from Home",
      });
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    const opener = document.activeElement as HTMLElement,
      overflow = document.body.style.overflow;
    el.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      el.close();
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) void load();
    });
    return () => {
      mounted = false;
    };
  }, [load]);
  useEffect(() => {
    let live = true;
    if (actor.role === "admin")
      void api("rules")
        .then((value) => {
          if (live) setSettings(value);
        })
        .catch(() => {
          /* Detail and permitted acknowledgement remain available. */
        });
    return () => {
      live = false;
    };
  }, [actor.role]);
  return (
    <dialog
      ref={dialog}
      className={s.drawer}
      aria-labelledby="notification-drawer-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className={s.heading}>
        <h2 id="notification-drawer-title">Notification detail</h2>
        <button
          onClick={onClose}
          autoFocus
          aria-label="Close notification detail"
        >
          ✕
        </button>
      </div>
      <div className={s.links}>
        <Link href={`/admin/notifications?id=${encodeURIComponent(id)}`}>
          Open in notification centre ↗
        </Link>
        <button onClick={() => void load()}>Refresh detail</button>
      </div>
      <div className={`${operations.root} ${s.body}`}>
        {error && (
          <p className={operations.error} role="alert">
            {error} <button onClick={() => void load()}>Retry detail</button>
          </p>
        )}
        {!data && !error && <p role="status">Loading notification…</p>}
        {data && (
          <NotificationDetail
            data={data}
            actor={actor}
            settings={settings}
            reload={async () => {
              await load();
              callbacks.current.onChanged();
            }}
          />
        )}
      </div>
    </dialog>
  );
}
