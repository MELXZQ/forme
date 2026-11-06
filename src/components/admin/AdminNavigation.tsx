"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { adminLocation, type AdminGroup } from "@/lib/admin-navigation";
import { Select } from "../ui/Select";
import s from "./AdminNavigation.module.css";

export function AdminNavigation({
  groups,
  role,
  testWorkspace,
}: {
  groups: AdminGroup[];
  role: string;
  testWorkspace: boolean;
}) {
  const pathname = usePathname(),
    params = useSearchParams(),
    router = useRouter();
  const location = adminLocation(pathname, params.toString());
  const active =
    groups.find((group) =>
      group.links.some((link) => link.href === location),
    ) || groups[0];
  const children = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const current = children.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    );
    if (current && children.current) {
      // Scroll only the tab strip, never the user's document position.
      children.current.scrollLeft = Math.max(
        0,
        current.offsetLeft - children.current.offsetLeft - 16,
      );
    }
  }, [location]);
  return (
    <header className={s.header} data-admin>
      <div className={s.top}>
        <Link className={s.brand} href="/admin">
          FORME <span>/ ADMIN</span>
        </Link>
        <span className={testWorkspace ? s.testBadge : s.badge}>
          {testWorkspace ? "Test workspace" : "Local workspace"}
        </span>
        <div className={s.utilities}>
          <span className={s.role}>
            {role === "admin"
              ? "Owner"
              : role === "warehouse"
                ? "Melbourne team"
                : "Read-only"}
          </span>
          <a href="/" target="_blank" rel="noreferrer">
            Open store ↗
          </a>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const response = await fetch("/api/auth/sign-out", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: "{}",
                });
                if (!response.ok)
                  throw new Error("Sign-out failed. Please try again.");
                router.replace("/admin/login");
                router.refresh();
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Could not reach the local service.",
                );
                setBusy(false);
              }
            }}
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
      <nav className={s.groups} aria-label="Admin sections">
        {groups.map((group) => (
          <Link
            href={group.links[0].href}
            key={group.id}
            aria-current={group.id === active.id ? "true" : undefined}
          >
            {group.label}
          </Link>
        ))}
      </nav>
      <div className={s.mobileGroup}>
        <label htmlFor="admin-section">Section</label>
        <Select
          id="admin-section"
          value={active.id}
          onChange={(e) => {
            const group = groups.find((g) => g.id === e.target.value);
            if (group) router.push(group.links[0].href);
          }}
        >
          {groups.map((g) => (
            <option value={g.id} key={g.id}>
              {g.label}
            </option>
          ))}
        </Select>
      </div>
      <nav
        ref={children}
        className={s.children}
        aria-label={`${active.label} pages`}
      >
        {active.links.map((link) => (
          <Link
            href={link.href}
            key={link.href}
            aria-current={location === link.href ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </header>
  );
}
