import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultLayout,
  catalogue,
  layoutSchema,
  widgetsSchema,
  newWidget,
  recoverLayout,
  canConfigure,
} from "../src/lib/home-layout";
import { dateBounds, localDay } from "../src/server/notifications/time";
import { settleHomeWidgets } from "../src/server/home/service";
const owner = { id: "a", role: "admin" },
  keeper = { id: "b", role: "warehouse" },
  viewer = { id: "c", role: "viewer" };
test("Home defaults and catalogue enforce role and explicit capabilities", () => {
  assert.deepEqual(
    defaultLayout(owner).map((w) => w.type),
    [
      "sales",
      "dispatch",
      "inventory",
      "notifications",
      "logistics",
      "trend",
      "expenses",
    ],
  );
  assert.deepEqual(
    defaultLayout(keeper).map((w) => w.type),
    ["receiving", "dispatch", "replacement", "stockIssues", "notifications"],
  );
  for (const role of [keeper, viewer])
    assert(
      !catalogue(role).some((w) =>
        ["sales", "trend", "expenses"].includes(w.type),
      ),
    );
  assert(
    catalogue({ ...keeper, capabilities: ["orderStats"] }).some(
      (w) => w.type === "sales",
    ),
  );
  assert(
    !canConfigure(keeper, {
      ...newWidget("inventory", "bj"),
      config: { warehouse: "BEIJING" },
    } as never),
  );
});
test("Home whitelist rejects missing core, duplicates, unsupported sizes and arbitrary configuration", () => {
  const base = { version: 1, revision: 0, widgets: defaultLayout(owner) };
  assert(layoutSchema.safeParse(base).success);
  assert(!layoutSchema.safeParse({ ...base, userId: "another-user" }).success);
  assert(
    !layoutSchema.safeParse({
      ...base,
      widgets: base.widgets.filter((w) => w.type !== "notifications"),
    }).success,
  );
  assert(
    !widgetsSchema.safeParse([
      newWidget("notifications", "n"),
      { ...newWidget("notifications", "n2"), size: "small" },
    ]).success,
  );
  assert(
    !widgetsSchema.safeParse([
      { ...newWidget("sales", "s"), config: { query: "arbitrary SQL" } },
    ]).success,
  );
  assert(
    !widgetsSchema.safeParse(
      Array.from({ length: 13 }, (_, i) => newWidget("inventory", "i" + i)),
    ).success,
  );
  assert(
    widgetsSchema.safeParse([
      newWidget("inventory", "a"),
      newWidget("inventory", "b"),
    ]).success,
  );
});
test("Home stored layouts recover safely across invalid versions, missing core and revoked grants", () => {
  assert.deepEqual(recoverLayout([], 99, owner).widgets, defaultLayout(owner));
  assert(
    recoverLayout([{ type: "invented" }], 1, keeper).widgets.some(
      (w) => w.type === "notifications",
    ),
  );
  const result = recoverLayout(defaultLayout(owner), 1, keeper);
  assert(result.recovered);
  assert(
    !result.widgets.some((w) =>
      ["sales", "trend", "expenses"].includes(w.type),
    ),
  );
  assert.equal(
    new Set(result.widgets.map((w) => w.id)).size,
    result.widgets.length,
  );
});
test("Personal calendar boundaries account for Melbourne DST and Shanghai midnight", () => {
  const spring = dateBounds("2026-10-04", "Australia/Melbourne"),
    autumn = dateBounds("2026-04-05", "Australia/Melbourne");
  assert.equal((spring.lt.getTime() - spring.gte.getTime()) / 3600000, 23);
  assert.equal((autumn.lt.getTime() - autumn.gte.getTime()) / 3600000, 25);
  assert.equal(
    localDay(new Date("2026-11-05T14:00:00Z"), "Australia/Melbourne"),
    "2026-11-06",
  );
  assert.equal(
    localDay(new Date("2026-11-05T14:00:00Z"), "Asia/Shanghai"),
    "2026-11-05",
  );
});
test("One failing Home widget does not zero its value or break other widgets", async () => {
  const result = await settleHomeWidgets(
    [newWidget("sales", "failed"), newWidget("dispatch", "good")],
    async (w) => {
      if (w.id === "failed") throw new Error("private internal stack");
      return { metrics: [], note: "Valid data" };
    },
  );
  assert.equal(result[0].status, "error");
  assert.equal(result[0].data, undefined);
  assert(!JSON.stringify(result[0]).includes("private internal"));
  assert.equal(result[1].status, "success");
  assert(result[1].updatedAt);
});
