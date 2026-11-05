import "server-only";
export function trustedOrigins() {
  const base = new URL(process.env.BETTER_AUTH_URL || "http://127.0.0.1:3000");
  const origins = [base.origin];
  if (["127.0.0.1", "localhost"].includes(base.hostname)) {
    base.hostname = base.hostname === "localhost" ? "127.0.0.1" : "localhost";
    origins.push(base.origin);
  }
  return origins;
}
