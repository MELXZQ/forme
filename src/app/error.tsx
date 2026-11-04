"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="loading-state">
      <h1>A small interruption.</h1>
      <p>We couldn’t load this view. Please try again.</p>
      <button onClick={reset}>Try again</button>
      <Link href="/">Return home</Link>
    </main>
  );
}
