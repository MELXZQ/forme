/* eslint-disable @typescript-eslint/no-explicit-any -- Runtime HTTP DTO assertions in this isolated test harness. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import sharp from "sharp";
import { config } from "dotenv";
async function run() {
  config({ path: ".local/operations-test.env", quiet: true });
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/forme_operations_test",
  );
  const { database } = await import("../../src/server/db");
  const db = database();
  const marker = await db.$queryRaw<
    { marker: string }[]
  >`SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`;
  assert.equal(marker[0].marker, "FORME disposable operations test database");
  const qa = JSON.parse(await fs.readFile(".local/operations-qa.json", "utf8"));
  const base = "http://127.0.0.1:3002",
    reason = "Synthetic HTTP verification",
    key = () => randomUUID();
  const checks: string[] = [];
  class Client {
    cookies = new Map<string, string>();
    async req(
      path: string,
      method = "GET",
      body?: unknown,
      origin: string | null = base,
    ) {
      const headers: Record<string, string> = {};
      if (this.cookies.size)
        headers.Cookie = [...this.cookies]
          .map(([k, v]) => `${k}=${v}`)
          .join("; ");
      if (origin && method !== "GET") headers.Origin = origin;
      let payload: BodyInit | undefined;
      if (body instanceof FormData) payload = body;
      else if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
      const res = await fetch(base + path, {
        method,
        headers,
        body: payload,
        redirect: "manual",
      });
      for (const c of res.headers.getSetCookie()) {
        const v = c.split(";")[0],
          i = v.indexOf("=");
        this.cookies.set(v.slice(0, i), v.slice(i + 1));
      }
      const text = await res.text();
      let json: { data?: any; error?: string } = {}; // Responses are asserted at each boundary below.
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: res.status, data: json.data, text, res };
    }
  }
  const owner = new Client(),
    keeper = new Client(),
    anon = new Client();
  const pass = (s: string) => {
    checks.push(s);
    console.log("PASS: " + s);
  };
  const status = async (p: Promise<{ status: number }>, s: number) =>
    assert.equal((await p).status, s);
  async function main() {
    for (const r of [
      "inventory",
      "transfers",
      "counts",
      "orders",
      "accounts",
      "settings",
      "history",
      "lookup",
    ]) {
      await status(anon.req(`/api/operations/${r}`), 401);
      await status(anon.req(`/api/operations/${r}`, "POST", {}), 401);
    }
    for (const r of [
      "products",
      "categories",
      "collections",
      "media",
      "home",
    ]) {
      await status(anon.req(`/api/admin/${r}`), 401);
      await status(anon.req(`/api/admin/${r}`, "POST", {}), 401);
    }
    await status(
      anon.req("/api/auth/sign-up/email", "POST", {
        email: "blocked@example.invalid",
        password: qa.password,
        name: "Blocked",
      }),
      404,
    );
    await status(
      owner.req("/api/auth/sign-in/email", "POST", {
        email: qa.ownerEmail,
        password: qa.password,
      }),
      200,
    );
    await status(
      keeper.req("/api/auth/sign-in/email", "POST", {
        email: qa.warehouseEmail,
        password: qa.password,
      }),
      200,
    );
    pass(
      "Anonymous callers cannot read or write management data; public administrator registration is disabled; personal owner/warehouse logins work.",
    );
    for (const r of ["accounts", "settings", "history"])
      await status(keeper.req(`/api/operations/${r}`), 403);
    await status(keeper.req("/api/admin/products"), 403);
    await status(
      keeper.req("/api/operations/inventory?warehouse=BEIJING"),
      403,
    );
    await status(keeper.req("/api/operations/orders?format=csv"), 403);
    await status(
      keeper.req("/api/operations/inventory/movement", "POST", {
        key: key(),
        variantId: qa.skuIds[4],
        warehouse: "BEIJING",
        kind: "PURCHASE",
        quantity: 1,
        reason,
      }),
      403,
    );
    const visible = await keeper.req(`/api/operations/orders/${qa.orderId}`);
    assert.equal(visible.status, 200);
    assert.ok(!("email" in visible.data));
    assert.ok(!("totalCents" in visible.data));
    const inv = await keeper.req("/api/operations/inventory");
    assert.ok(
      inv.data.items.every(
        (v: any) => !v.beijing && v.legacyRemaining === undefined,
      ),
    );
    const warehouseCsv = await keeper.req(
      "/api/operations/inventory?format=csv",
    );
    assert.equal(warehouseCsv.status, 200);
    assert.ok(!warehouseCsv.text.includes("Beijing physical"));
    await status(
      owner.req(
        "/api/operations/settings",
        "POST",
        { key: key(), shippingCents: 1200, reservationMinutes: 30, reason },
        "https://untrusted.example",
      ),
      403,
    );
    await status(owner.req("/api/operations/settings", "POST", {}, null), 403);
    pass(
      "Direct warehouse requests are restricted and customer fields are minimized; inventory export is scoped to Melbourne; foreign or missing write origins are rejected.",
    );
    const cats = await owner.req("/api/admin/categories"),
      cols = await owner.req("/api/admin/collections");
    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#a68168" },
    })
      .png()
      .toBuffer();
    await fs.writeFile(".local/operations-receipt.png", png, { mode: 0o600 });
    const upload = new FormData();
    upload.append(
      "files",
      new File([new Uint8Array(png)], "http.png", { type: "image/png" }),
    );
    const uploaded = await owner.req("/api/admin/media", "POST", upload);
    assert.equal(uploaded.status, 200);
    const mediaId = uploaded.data[0].id;
    for (const [name, bytes, mime] of [
      ["evil.svg", "<svg onload='alert(1)'></svg>", "image/svg+xml"],
      ["fake.jpg", "not an image", "image/jpeg"],
    ]) {
      const form = new FormData();
      form.append("files", new File([bytes], name, { type: mime }));
      await status(owner.req("/api/admin/media", "POST", form), 400);
    }
    const makeVariant = (sku: string, size: string) => ({
      sku,
      size,
      color: "Silver",
      priceCents: 8900,
      compareAtPriceCents: 9900,
      currency: "AUD",
      stock: 0,
      enabled: true,
      sortOrder: 0,
    });
    let product: any = {
      slug: `http-verification-${key()}`,
      name: "HTTP Verification Ring",
      status: "DRAFT",
      categoryId: cats.data[0].id,
      collectionIds: [cols.data[0].id],
      isFeatured: true,
      featuredOrder: 0,
      summary: "Synthetic test",
      description: "Synthetic test description",
      variants: [
        makeVariant(`HTTP-8-${key()}`, "8"),
        makeVariant(`HTTP-9-${key()}`, "9"),
      ],
      images: [{ mediaId, alt: "Synthetic verification image", sortOrder: 0 }],
    };
    const created = await owner.req("/api/admin/products", "POST", product);
    assert.equal(created.status, 200);
    const productId = created.data.id;
    await status(anon.req(`/api/catalog/products/${product.slug}`), 404);
    product = (await owner.req(`/api/admin/products/${productId}`)).data;
    assert.equal(product.variants.length, 2);
    for (const variants of [
      [{ ...product.variants[0], priceCents: 0 }],
      [{ ...product.variants[0], stock: -1 }],
      [
        product.variants[0],
        { ...product.variants[1], sku: product.variants[0].sku },
      ],
    ])
      await status(
        owner.req(`/api/admin/products/${productId}`, "PUT", {
          ...product,
          variants,
        }),
        400,
      );
    await status(
      owner.req(`/api/admin/products/${productId}`, "PUT", {
        ...product,
        status: "PUBLISHED",
        changeReason: reason,
      }),
      200,
    );
    const v = product.variants[0].id;
    await status(
      owner.req("/api/operations/inventory/movement", "POST", {
        key: key(),
        variantId: v,
        warehouse: "MELBOURNE",
        quantity: 2,
        kind: "INITIAL",
        reason,
      }),
      200,
    );
    let publicP = await anon.req(`/api/catalog/products/${product.slug}`);
    assert.equal(publicP.status, 200);
    assert.equal(publicP.data.variants[0].stock, 2);
    assert.equal(publicP.data.availability, "IN_STOCK");
    assert.ok(
      !publicP.text.includes("legacyRemaining") &&
        !publicP.text.includes("beijing"),
    );
    for (const q of [
      `q=HTTP&category=${cats.data[0].slug}&collection=${cols.data[0].slug}&sale=true&sort=newest`,
      `q=HTTP&pageSize=1`,
    ]) {
      const list = await anon.req(`/api/catalog/products?${q}`);
      assert.equal(list.status, 200);
      assert.ok(list.data.items.some((p: any) => p.id === productId));
    }
    await status(owner.req(`/api/admin/media/${mediaId}`, "DELETE"), 409);
    pass(
      "HTTP catalog lifecycle supports two sizes, actual image upload, draft/publish, combined URL filters and protected media; invalid amounts, stock, duplicate SKUs, SVG and disguised files are rejected.",
    );
    const items = [{ variantId: v, quantity: 1 }];
    const orderBody = {
      key: key(),
      items,
      email: "http-customer@example.invalid",
      recipientName: "Synthetic HTTP Customer",
      addressLine1: "100 Test Street",
      addressLine2: "",
      city: "Melbourne",
      state: "VIC",
      postcode: "3000",
      country: "AU",
    };
    await status(
      owner.req("/api/operations/settings", "POST", {
        key: key(),
        shippingCents: null,
        reservationMinutes: 30,
        reason,
      }),
      200,
    );
    await status(anon.req("/api/checkout/create", "POST", orderBody), 409);
    await status(
      owner.req("/api/operations/settings", "POST", {
        key: key(),
        shippingCents: 1200,
        reservationMinutes: 30,
        reason,
      }),
      200,
    );
    await status(
      anon.req("/api/checkout/create", "POST", { ...orderBody, totalCents: 1 }),
      400,
    );
    await status(
      anon.req("/api/checkout/create", "POST", {
        ...orderBody,
        items: [{ variantId: v, quantity: 3 }],
      }),
      409,
    );
    const ordered = await anon.req("/api/checkout/create", "POST", orderBody);
    assert.equal(ordered.status, 200);
    const orderId = ordered.data.id;
    assert.ok(!ordered.text.includes("token"));
    const cookie = ordered.res.headers.getSetCookie().join(";");
    assert.ok(cookie.includes("HttpOnly") && /SameSite=Lax/i.test(cookie));
    await status(anon.req("/api/checkout/create", "POST", orderBody), 200);
    assert.equal(
      (
        await db.inventoryBalance.findUniqueOrThrow({
          where: {
            variantId_warehouse: { variantId: v, warehouse: "MELBOURNE" },
          },
        })
      ).reserved,
      1,
    );
    const privateOrder = await anon.req(`/api/orders/${orderId}`);
    assert.equal(privateOrder.status, 200);
    assert.equal(privateOrder.data.totalCents, 10100);
    const outsider = new Client();
    await status(outsider.req(`/api/orders/${orderId}`), 404);
    await status(anon.req(`/api/orders/${qa.orderId}`), 404);
    const access = await anon.req(
      `/api/orders/${orderId}/lookup-link`,
      "POST",
      {},
    );
    assert.equal(access.status, 200);
    await status(
      outsider.req(`/api/orders/${orderId}/access`, "POST", {
        token: access.data.token,
      }),
      200,
    );
    await status(outsider.req(`/api/orders/${orderId}`), 200);
    const cancel = { key: key(), reason };
    await status(
      anon.req(`/api/orders/${orderId}/cancel`, "POST", cancel),
      200,
    );
    await status(
      anon.req(`/api/orders/${orderId}/cancel`, "POST", cancel),
      200,
    );
    await status(
      anon.req(`/api/orders/${orderId}/simulate-payment`, "POST", {}),
      404,
    );
    pass(
      "Guest checkout recomputes prices, blocks unconfigured shipping and excess quantity, reserves once on retries, uses scoped HttpOnly access, supports private lookup links and cancels without duplicate release.",
    );
    product.variants[0].priceCents = 9500;
    product.variants[0].compareAtPriceCents = 10000;
    await status(
      owner.req(`/api/admin/products/${productId}`, "PUT", {
        ...product,
        status: "PUBLISHED",
        changeReason: reason,
      }),
      200,
    );
    publicP = await anon.req(`/api/catalog/products/${product.slug}`);
    assert.equal(
      publicP.data.variants.find((sku: any) => sku.id === v).priceCents,
      9500,
    );
    assert.equal(
      (await anon.req(`/api/orders/${orderId}`)).data.lines[0].unitPriceCents,
      8900,
    );
    await status(
      owner.req(`/api/admin/products/${productId}`, "PUT", {
        ...product,
        status: "ARCHIVED",
        changeReason: reason,
      }),
      200,
    );
    await status(anon.req(`/api/catalog/products/${product.slug}`), 404);
    const viewerEmail = `http-viewer-${key()}@verification.invalid`;
    const viewerCreated = await owner.req("/api/operations/accounts", "POST", {
      key: key(),
      name: "Synthetic Viewer",
      email: viewerEmail,
      password: qa.password,
      role: "viewer",
      reason,
    });
    assert.equal(viewerCreated.status, 200);
    const viewer = new Client();
    await status(
      viewer.req("/api/auth/sign-in/email", "POST", {
        email: viewerEmail,
        password: qa.password,
      }),
      200,
    );
    await status(viewer.req("/api/operations/orders"), 403);
    await status(viewer.req("/api/operations/inventory"), 200);
    await status(
      owner.req(`/api/operations/accounts/${qa.warehouseId}`, "POST", {
        key: key(),
        role: "viewer",
        active: true,
        reason,
      }),
      200,
    );
    await status(keeper.req("/api/operations/inventory"), 401);
    await status(
      owner.req(`/api/operations/accounts/${qa.warehouseId}`, "POST", {
        key: key(),
        role: "warehouse",
        active: true,
        reason,
      }),
      200,
    );
    await status(
      owner.req(`/api/operations/accounts/${qa.ownerId}`, "POST", {
        key: key(),
        role: "admin",
        active: false,
        reason,
      }),
      409,
    );
    await status(owner.req("/api/auth/sign-out", "POST", {}), 200);
    await status(owner.req("/api/operations/accounts"), 401);
    pass(
      "Price changes reach public responses while order snapshots stay unchanged; archive returns 404; viewer restrictions, permission revocation, last-owner protection and logout are enforced over HTTP.",
    );
    await fs.writeFile(
      ".local/operations-http-verification.json",
      JSON.stringify(
        { passed: true, checks, productId, orderId, mediaId },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(
      `PASS: ${checks.length} HTTP verification groups; isolated database only.`,
    );
  }
  main()
    .catch((e) => {
      console.error(
        "HTTP verification failed:",
        e instanceof assert.AssertionError
          ? `${e.operator}: actual ${String(e.actual)}, expected ${String(e.expected)}`
          : e instanceof Error
            ? e.name
            : "Unknown",
      );
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
void run().catch(() => {
  console.error(
    "HTTP verification setup failed; private configuration was not printed.",
  );
  process.exitCode = 1;
});
