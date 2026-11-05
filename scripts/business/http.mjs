import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const qa = JSON.parse(await readFile(".local/operations-qa.json", "utf8")),
  state = JSON.parse(
    await readFile(".local/business-verification.json", "utf8"),
  ),
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
const ok = async (request, status) => {
  const r = await request;
  assert.equal(r.status, status);
  return r;
};
const pass = (s) => {
  checks.push(s);
  console.log("PASS: " + s);
};
try {
  for (const path of [
    "meta",
    "suppliers",
    "purchases",
    "expenses",
    "recurring",
    "logistics",
    "grants",
    "attachment/" + state.attachmentId,
  ]) {
    await ok(anon.req("/api/business/" + path), 401);
    await ok(anon.req("/api/business/" + path, {}), 401);
  }
  await ok(anon.req("/admin/business"), 307);
  pass(
    "Unauthenticated business API reads and writes are rejected; the admin page redirects to login.",
  );
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
  for (const path of [
    "suppliers",
    "purchases",
    "expenses",
    "expenses?format=csv",
    "recurring",
    "grants",
    "attachment/" + state.attachmentId,
  ])
    await ok(keeper.req("/api/business/" + path), 403);
  for (const path of [
    "suppliers",
    "purchases",
    "expenses",
    "recurring",
    "grants",
  ])
    await ok(keeper.req("/api/business/" + path, {}), 403);
  const receiving = await ok(
    keeper.req("/api/business/purchases/" + state.purchaseId + "/receiving"),
    200,
  );
  assert.ok(!JSON.stringify(receiving.value).includes("unitCost"));
  const parcel = await ok(
    keeper.req("/api/business/logistics/" + state.parcelId),
    200,
  );
  assert.ok(!JSON.stringify(parcel.value).includes("accountAlias"));
  pass(
    "Direct warehouse requests cannot obtain procurement costs, finance exports, private evidence or rule writes; acceptance and logistics remain usable.",
  );
  await ok(
    owner.req("/api/business/suppliers", {}, "https://untrusted.invalid"),
    403,
  );
  await ok(owner.req("/api/business/expenses?from=2026-02-30"), 400);
  await ok(
    owner.req("/api/business/expenses", {
      key: randomUUID(),
      reason: "Invalid amount test",
      amount: -1,
    }),
    400,
  );
  await ok(owner.req("/api/business/purchases/not-found"), 404);
  pass(
    "Cross-origin writes, invalid calendar dates and invalid financial input are rejected; unknown records return 404.",
  );
  const evidence = await ok(
    owner.req("/api/business/attachment/" + state.attachmentId),
    200,
  );
  assert.equal(evidence.headers.get("content-type"), "image/webp");
  assert.ok(
    evidence.headers.get("content-security-policy").includes("sandbox"),
  );
  assert.ok(evidence.value.length > 0);
  await ok(anon.req("/media/" + state.attachmentId), 404);
  const csv = await ok(owner.req("/api/business/expenses?format=csv"), 200);
  assert.ok(csv.value.includes("minor units"));
  assert.equal(csv.headers.get("cache-control"), "no-store");
  pass(
    "Evidence is protected, downloaded as an image with restrictive headers, and unavailable through the public media route. Authorized CSV is explicit about minor units.",
  );
  const supplier = await ok(
    owner.req("/api/business/suppliers", {
      key: randomUUID(),
      reason: "Synthetic HTTP supplier test",
      code: "HTTP-" + randomUUID(),
      name: "HTTP verification supplier",
      currency: "AUD",
    }),
    200,
  );
  assert.ok(supplier.value.data.id);
  await ok(owner.req("/api/auth/sign-out", {}), 200);
  await ok(owner.req("/api/business/meta"), 401);
  pass(
    "Authorized mutation works through the live API and logout removes access.",
  );
  await writeFile(
    ".local/business-http-verification.json",
    JSON.stringify({ passed: true, checks }, null, 2),
    { mode: 0o600 },
  );
} catch (e) {
  console.error("Business HTTP verification failed:", e.message);
  process.exitCode = 1;
}
