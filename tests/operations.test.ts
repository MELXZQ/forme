import test from "node:test";
import assert from "node:assert/strict";
import {
  statusFor,
  melbourneToday,
} from "../src/server/operations/availability";
import { aggregateAvailability } from "../src/lib/availability";
import { remaining } from "../src/server/operations/transfers";
import { csvCell } from "../src/server/operations/core";
import {
  receiptSchema,
  checkoutSchema,
  stockAction,
} from "../src/server/operations/validation";
test("warehouse availability follows the four states without exposing Beijing quantities", () => {
  assert.equal(statusFor(2, 10, 20, false), "IN_STOCK");
  assert.equal(statusFor(0, 2, 20), "RESTOCKING_SOON");
  assert.equal(statusFor(0, 0, 20), "RESTOCK_PLANNED");
  assert.equal(statusFor(0, 0, 0), "OUT_OF_STOCK");
  assert.equal(statusFor(0, 20, 20, false), "OUT_OF_STOCK");
  assert.equal(
    aggregateAvailability(["OUT_OF_STOCK", "RESTOCKING_SOON", "IN_STOCK"]),
    "IN_STOCK",
  );
  assert.equal(melbourneToday(new Date("2026-11-05T15:00:00Z")), "2026-11-06");
  assert.equal(
    remaining({
      sent: 20,
      receivedSellable: 17,
      receivedUnavailable: 1,
      lost: 1,
      returned: 1,
    }),
    0,
  );
});
test("receipts and stock changes require positive, non-duplicated, bounded integer quantities", () => {
  const line = { lineId: "line", sellable: 17, unavailable: 1, lost: 0 };
  const base = {
    key: "verification-key",
    reason: "Counted receipt",
    lines: [line],
  };
  assert.equal(receiptSchema.safeParse(base).success, true);
  assert.equal(
    receiptSchema.safeParse({ ...base, lines: [line, line] }).success,
    false,
  );
  assert.equal(
    receiptSchema.safeParse({
      ...base,
      lines: [{ ...line, sellable: 0, unavailable: 0 }],
    }).success,
    false,
  );
  for (const quantity of [-1, 0, 1.5, Infinity])
    assert.equal(
      stockAction.safeParse({
        key: "verification-key",
        reason: "Physical count",
        kind: "PURCHASE",
        variantId: "id",
        warehouse: "BEIJING",
        quantity,
      }).success,
      false,
    );
});
test("guest checkout rejects price injection, foreign destinations and malformed contacts", () => {
  const v = {
    key: "verification-key",
    items: [{ variantId: "sku", quantity: 1 }],
    email: "test@example.invalid",
    recipientName: "Synthetic Person",
    addressLine1: "100 Test Street",
    city: "Melbourne",
    state: "VIC",
    postcode: "3000",
    country: "AU",
  };
  assert.equal(checkoutSchema.safeParse(v).success, true);
  for (const change of [
    { priceCents: 1 },
    { country: "CN" },
    { postcode: "abc" },
    { state: "BEIJING" },
    { email: "invalid" },
    {
      items: [
        { variantId: "sku", quantity: 1 },
        { variantId: "sku", quantity: 1 },
      ],
    },
  ])
    assert.equal(checkoutSchema.safeParse({ ...v, ...change }).success, false);
});
test("CSV quotes values and neutralizes formulas including whitespace prefixes", () => {
  for (const input of [
    "=1+1",
    "+SUM(1,2)",
    "-cmd",
    "@SUM(1)",
    " \t=HYPERLINK(x)",
  ])
    assert.ok(csvCell(input).startsWith("\"'"));
  assert.equal(csvCell('a"b,c'), '"a""b,c"');
});
