import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const qa = JSON.parse(await readFile(".local/operations-qa.json", "utf8"));
const base = "http://127.0.0.1:3002";
class Client {
  cookies = new Map();
  async req(path, body, origin = base) {
    const headers = {};
    if (this.cookies.size)
      headers.Cookie = [...this.cookies]
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      if (origin) headers.Origin = origin;
    }
    const res = await fetch(base + path.replace(/\/(?=\?|$)/, ""), {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie()) {
      const first = c.split(";")[0],
        i = first.indexOf("=");
      this.cookies.set(first.slice(0, i), first.slice(i + 1));
    }
    const value = await res.json().catch(() => ({}));
    return { status: res.status, data: value.data };
  }
}
const anon = new Client(),
  owner = new Client(),
  keeper = new Client();
const ok = async (p, status) => assert.equal((await p).status, status);
try {
  for (const path of ["", "rules", "products", "stock", "item/not-found"]) {
    await ok(anon.req("/api/notifications/" + path), 401);
    await ok(anon.req("/api/notifications/" + path, {}), 401);
  }
  await ok(
    owner.req("/api/auth/sign-in/email", {
      email: qa.ownerEmail,
      password: qa.password,
    }),
    200,
  );
  await ok(
    keeper.req("/api/auth/sign-in/email", {
      email: qa.warehouseEmail,
      password: qa.password,
    }),
    200,
  );
  for (const path of ["rules", "products", "stock"])
    await ok(keeper.req("/api/notifications/" + path), 403);
  for (const path of ["rules", "products", "stock", "check", "preview"])
    await ok(
      keeper.req("/api/notifications/" + path, {}),
      path === "preview" ? 400 : 403,
    );
  await ok(
    owner.req(
      "/api/notifications/preference",
      { timezone: "Asia/Shanghai" },
      "https://untrusted.invalid",
    ),
    403,
  );
  await ok(
    owner.req("/api/notifications/preference", { timezone: "invalid-zone" }),
    400,
  );
  await ok(owner.req("/api/notifications/?severity=5"), 400);
  await ok(owner.req("/api/notifications/?day=2026-02-30"), 400);
  await ok(
    owner.req("/api/notifications/preference", { timezone: "Asia/Shanghai" }),
    200,
  );
  assert.equal(
    (await owner.req("/api/notifications/")).data.timezone,
    "Asia/Shanghai",
  );
  const notes = (await owner.req("/api/notifications/?view=all")).data;
  assert.ok(notes.items.length);
  const inventory = notes.items.find((n) => n.type === "INVENTORY");
  assert.ok(inventory);
  await ok(keeper.req("/api/notifications/item/" + inventory.id), 404);
  await ok(
    owner.req("/api/notifications/item/" + inventory.id, {
      key: randomUUID(),
      version: inventory.version,
      action: "ack",
      reason: "Synthetic HTTP acknowledgement",
      userId: qa.warehouseId,
    }),
    400,
  );
  await ok(
    owner.req("/api/notifications/item/" + inventory.id, {
      key: randomUUID(),
      version: inventory.version + 100,
      action: "ack",
      reason: "Synthetic stale version",
    }),
    409,
  );
  await ok(
    owner.req("/api/notifications/preference", {
      timezone: "Australia/Melbourne",
    }),
    200,
  );
  await writeFile(
    ".local/notification-http-verification.json",
    JSON.stringify(
      {
        passed: true,
        checks: [
          "Anonymous notification reads/writes denied",
          "Owner-only rule and batch APIs protected",
          "CSRF and invalid date/zone/filter rejected",
          "Timezone preference persisted",
          "Warehouse cannot read unauthorized stock snapshot",
          "Cannot confirm for another user or stale version",
        ],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "PASS: Notification HTTP authorization, CSRF, timezone, date validation and confirmation isolation.",
  );
} catch (e) {
  console.error(
    "Notification HTTP verification failed:",
    e instanceof assert.AssertionError ? `${e.actual} / ${e.expected}` : e.name,
  );
  process.exitCode = 1;
}
