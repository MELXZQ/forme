"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import s from "./Admin.module.css";
export function Login() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <div className={s.login} data-admin>
      <h1>FORME / Admin</h1>
      <p>
        Sign in to manage products and homepage content. This is a local
        administration area.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const data = new FormData(e.currentTarget);
          try {
            const r = await fetch("/api/auth/sign-in/email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: data.get("email"),
                password: data.get("password"),
              }),
            });
            if (!r.ok) {
              setError(
                r.status === 429
                  ? "Too many attempts. Wait one minute before trying again."
                  : "Sign-in failed. Check your credentials and that the database is running.",
              );
              return;
            }
            router.replace("/admin");
            router.refresh();
          } catch {
            setError("Could not reach the local service.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className={s.field}>
          Email
          <input type="email" name="email" autoComplete="username" required />
        </label>
        <label className={s.field}>
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        {error && (
          <p role="alert" className={`${s.notice} ${s.error}`}>
            {error}
          </p>
        )}
        <button className={s.button} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p style={{ marginTop: 24 }}>
        First administrator: run <code>npm run admin:create</code> in your local
        project terminal. Passwords are entered privately there.
      </p>
      <p>
        <Link href="/">Return to store</Link>
      </p>
    </div>
  );
}
