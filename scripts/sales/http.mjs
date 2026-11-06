import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const qa = JSON.parse(await readFile(".local/operations-qa.json", "utf8")),
  state = JSON.parse(await readFile(".local/sales-verification.json", "utf8")),
  base = "http://127.0.0.1:3002";
class Client {
  cookies = new Map();
  async req(path, body, origin = base) {
    const headers = {};
    if (this.cookies.size)
      headers.Cookie = [...this.cookies]
        .map(([k, v]) => k + "=" + v)
        .join("; ");
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers.Origin = origin;
    }
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const c of response.headers.getSetCookie()) {
      const pair = c.split(";")[0],
        i = pair.indexOf("=");
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const type = response.headers.get("content-type") || "";
    return {
      status: response.status,
      headers: response.headers,
      value: type.includes("json")
        ? await response.json()
        : type.includes("text")
          ? await response.text()
          : new Uint8Array(await response.arrayBuffer()),
    };
  }
}

const anon = new Client(),
  owner = new Client(),
  keeper = new Client(),
  checks = [];
const ok = async (p, status = 200) => {
    const r = await p;
    assert.equal(r.status, status, JSON.stringify(r.value).slice(0, 250));
    return r;
  },
  pass = (s) => {
    checks.push(s);
    console.log("PASS: " + s);
  };
try {
  for (const path of [
    "orders",
    "orders/" + state.orderId,
    "analytics",
    "cases",
    "compensations",
    "rules",
    "home",
  ]) {
    await ok(anon.req("/api/sales/" + path), 401);
    await ok(anon.req("/api/sales/" + path, {}), 401);
  }
  await ok(anon.req("/admin/sales"), 307);
  await ok(
    owner.req("/api/auth/sign-in/email", {
      email: qa.ownerEmail,
      password: qa.password,
    }),
  );
  await ok(
    keeper.req("/api/auth/sign-in/email", {
      email: qa.warehouseEmail,
      password: qa.password,
    }),
  );
  pass(
    "Anonymous advanced orders, statistics, care, rules and dashboard endpoints reject reads/writes; admin page redirects to login.",
  );
  await ok(
    keeper.req(
      "/api/sales/analytics?from=2026-10-01&to=2026-10-31&asOf=2026-11-03",
    ),
    403,
  );
  await ok(keeper.req("/api/sales/orders?format=csv"), 403);
  await ok(keeper.req("/api/sales/rules"), 403);
  await ok(keeper.req("/api/business/attachment/" + state.attachmentId), 403);
  const comp = (
    await ok(owner.req("/api/sales/compensations/" + state.compensationId))
  ).value.data;
  for (const action of ["APPROVE", "REFUND"])
    await ok(
      keeper.req(
        "/api/sales/compensations/" + state.compensationId + "/action",
        {
          key: randomUUID(),
          reason: "Synthetic forbidden request",
          version: comp.version,
          action,
          occurredAt: new Date().toISOString(),
        },
      ),
      403,
    );
  const fulfillment = (
    await ok(keeper.req("/api/sales/orders/" + state.orderId))
  ).value.data;
  assert.equal(fulfillment.email, undefined);
  assert.equal(fulfillment.totalCents, undefined);
  assert.ok(fulfillment.recipientName);
  assert.ok(!JSON.stringify(fulfillment.events).includes("PRIVATE-SALES-NOTE"));
  pass(
    "Direct warehouse requests cannot read income, export customers, manage timeouts, approve/execute money compensation or download refund evidence; fulfillment data is minimized.",
  );
  await ok(
    owner.req(
      "/api/sales/filters",
      {
        key: randomUUID(),
        reason: "Bad origin check",
        name: "Invalid",
        query: {},
      },
      "https://outside.invalid",
    ),
    403,
  );
  await ok(owner.req("/api/sales/orders?from=2026-02-30"), 400);
  await ok(owner.req("/api/sales/orders?min=-1"), 400);
  await ok(owner.req("/api/sales/orders/missing"), 404);
  const report = (
    await ok(
      owner.req(
        "/api/sales/analytics?from=2026-10-01&to=2026-10-31&asOf=2026-11-03&product=" +
          state.productId,
      ),
    )
  ).value.data;
  assert.equal(report.totals.received, 6000);
  assert.equal(report.totals.refunded, 0);
  assert.equal(report.cohort.refundCents, 500);
  assert.equal(report.totals.discount, 0);
  const page = (
    await ok(
      owner.req(
        "/api/sales/orders?dateField=paid&from=2026-10-01&to=2026-10-31&sku=" +
          encodeURIComponent(state.sku) +
          "&pageSize=1",
      ),
    )
  ).value.data;
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
  assert.equal(page.summary.wholeOrders.totalCents, 6000);
  const csv = await ok(
    owner.req("/api/sales/orders?product=" + state.productId + "&format=csv"),
  );
  assert.equal(csv.headers.get("cache-control"), "no-store");
  assert.ok(!csv.value.includes("sales-sample@verification.invalid"));
  await ok(
    owner.req(
      "/api/sales/orders?product=" + state.productId + "&format=csv&pii=true",
    ),
  );
  pass(
    "Validated URL filters, timezone reports, full-result totals and minimal authorized CSV agree with the AUD60 / AUD5 sample; invalid dates, money and cross-origin writes are rejected.",
  );
  await ok(
    owner.req("/api/sales/filters", {
      key: randomUUID(),
      reason: "Synthetic personal filter",
      name: "HTTP sales filter",
      query: { sku: state.sku, dateField: "paid" },
    }),
  );
  const home = (await ok(keeper.req("/api/sales/home"))).value.data;
  assert.ok(home.items.some((t) => t.objectId === state.caseId));
  assert.ok(!home.items.some((t) => t.source === "expense"));
  await ok(owner.req("/api/auth/sign-out", {}));
  await ok(owner.req("/api/sales/orders"), 401);
  pass(
    "Personal filters save through HTTP, role homepage shows assigned work without financial tasks, and logout revokes access.",
  );
  await writeFile(
    ".local/sales-http-verification.json",
    JSON.stringify({ passed: true, checks }),
    { mode: 0o600 },
  );
} catch (e) {
  console.error(
    "Sales HTTP verification failed:",
    e instanceof Error ? e.message : "unknown",
  );
  process.exitCode = 1;
}
