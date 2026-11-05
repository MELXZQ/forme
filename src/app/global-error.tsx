"use client";
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "Arial,sans-serif",
          padding: 40,
          background: "#f8f7f4",
          color: "#292b2c",
        }}
      >
        <h1>The local data service is unavailable.</h1>
        <p>
          Start PostgreSQL with <code>npm run db:start</code>. On first setup,
          run <code>npm run db:setup</code>, <code>npm run db:migrate</code> and{" "}
          <code>npm run db:seed</code>.
        </p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
