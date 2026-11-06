import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const qa = JSON.parse(await readFile(".local/home-qa.json", "utf8"));
const base = "http://127.0.0.1:3002";
class Client {
  cookies = new Map();
  async call(path, body, method = "POST", origin = base) {
    const response = await fetch(base + path, {
      redirect: "manual",
      method: body === undefined ? "GET" : method,
      headers: {
        ...(this.cookies.size
          ? {
              Cookie: [...this.cookies].map(([k, v]) => k + "=" + v).join("; "),
            }
          : {}),
        ...(body === undefined
          ? {}
          : { "Content-Type": "application/json", Origin: origin }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0],
        i = pair.indexOf("=");
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const json = response.headers.get("content-type")?.includes("json")
      ? await response.json()
      : {};
    return {
      status: response.status,
      data: json.data,
      error: json.error,
      cache: response.headers.get("cache-control"),
    };
  }
}
const checks = [],
  pass = (text) => {
    checks.push(text);
    console.log("PASS: " + text);
  };
const expect = async (promise, status = 200) => {
  const result = await promise;
  assert.equal(result.status, status, result.error);
  return result.data;
};
const anon = new Client(),
  owner = new Client(),
  keeper = new Client();
await expect(anon.call("/api/home"), 401);
await expect(anon.call("/api/home/data", { widgets: [] }), 401);
await expect(anon.call("/api/home", {}, "PUT"), 401);
await expect(anon.call("/admin"), 307);
pass(
  "Anonymous Home metadata, widget data, layout writes and page are protected",
);
await expect(
  owner.call("/api/auth/sign-in/email", {
    email: qa.ownerEmail,
    password: qa.password,
  }),
);
await expect(
  keeper.call("/api/auth/sign-in/email", {
    email: qa.keeperEmail,
    password: qa.password,
  }),
);
const meta = await expect(owner.call("/api/home")),
  other = await expect(keeper.call("/api/home"));
const sales = meta.widgets.find((w) => w.type === "sales");
assert(
  !other.catalogue.some((d) => ["sales", "trend", "expenses"].includes(d.type)),
);
await expect(keeper.call("/api/home/data", { widgets: [sales] }), 403);
await expect(
  keeper.call(
    "/api/home",
    {
      version: 1,
      revision: other.revision,
      widgets: [...other.widgets, sales],
    },
    "PUT",
  ),
  403,
);
pass(
  "Warehouse catalogue and direct data/save requests cannot access financial widgets",
);
const layout = { version: 1, revision: meta.revision, widgets: meta.widgets };
await expect(
  owner.call("/api/home", layout, "PUT", "https://untrusted.example"),
  403,
);
await expect(
  owner.call("/api/home", { ...layout, userId: qa.keeperId }, "PUT"),
  400,
);
await expect(
  owner.call(
    "/api/home",
    {
      ...layout,
      widgets: meta.widgets.filter((w) => w.type !== "notifications"),
    },
    "PUT",
  ),
  400,
);
await expect(
  owner.call("/api/home/data", {
    widgets: [{ ...sales, config: { query: "script" } }],
  }),
  400,
);
await expect(
  owner.call("/api/home/data", { widgets: [{ ...sales, size: "large" }] }),
  400,
);
await expect(
  owner.call("/api/home", { ...layout, unexpected: "x".repeat(20000) }, "PUT"),
  413,
);
pass(
  "CSRF, user-ID injection, missing core card, unsafe config, invalid size and oversized bodies rejected",
);
const reordered = [...meta.widgets].reverse();
const saved = await expect(
  owner.call("/api/home", { ...layout, widgets: reordered }, "PUT"),
);
assert.deepEqual(
  (await expect(keeper.call("/api/home"))).widgets,
  other.widgets,
);
await expect(owner.call("/api/auth/sign-out", {}));
await expect(owner.call("/api/home"), 401);
await expect(
  owner.call("/api/auth/sign-in/email", {
    email: qa.ownerEmail,
    password: qa.password,
  }),
);
const reloaded = await expect(owner.call("/api/home"));
assert.deepEqual(reloaded.widgets, reordered);
await expect(
  owner.call(
    "/api/home",
    { version: 1, revision: saved.revision, widgets: meta.widgets },
    "PUT",
  ),
);
pass(
  "Layout persists across logout/login; second admin remains unchanged; original layout restored",
);
const data = await expect(
  owner.call("/api/home/data", { widgets: meta.widgets }),
);
assert(data.results.every((r) => !["forbidden", "error"].includes(r.status)));
assert(
  data.results.find((r) => r.id === sales.id).data.metrics[0].value === 4900,
);
assert.equal((await owner.call("/api/home")).cache, "no-store");
const warehouse = await expect(
  keeper.call("/api/home/data", { widgets: other.widgets }),
);
assert(
  warehouse.results.every((r) => !["forbidden", "error"].includes(r.status)),
);
assert(!JSON.stringify(warehouse.results).includes('"currency":"AUD"'));
pass(
  "Authenticated owner and warehouse aggregates load without errors; no-store headers and financial redaction verified",
);
await writeFile(
  ".local/home-http-verification.json",
  JSON.stringify({ at: new Date(), checks }, null, 2),
);
