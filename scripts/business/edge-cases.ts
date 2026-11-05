import assert from "node:assert/strict";
import { config } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
async function main() {
  config({ path: ".local/operations-test.env", quiet: true });
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/forme_operations_test",
  );
  const { database } = await import("../../src/server/db");
  const db = database();
  const qa = JSON.parse(await readFile(".local/operations-qa.json", "utf8"));
  const owner = { id: qa.ownerId, role: "admin" as const };
  const E = await import("../../src/server/business/expenses"),
    Q = await import("../../src/server/business/queries"),
    R = await import("../../src/server/business/recurring");
  const { runNotificationCheck } =
    await import("../../src/server/notifications/engine");
  const base = () => ({
    key: randomUUID(),
    reason: "Synthetic edge-case verification",
  });
  const checks: string[] = [];
  const pass = (s: string) => {
    checks.push(s);
    console.log("PASS: " + s);
  };
  try {
    const input = {
      name: "Historical synthetic subscription",
      payee: "Synthetic service",
      categoryId: "software",
      assigneeId: owner.id,
      currency: "AUD",
      amount: 100,
      unit: "MONTH",
      interval: 1,
      anchorDate: "2025-01-31",
      endDate: "2025-12-31",
      timezone: "Australia/Melbourne",
      reminderDays: 7,
      graceDays: 0,
      paymentMode: "PROVIDER_AUTO",
      expectedResult: "Service active",
      verificationMethod: "Manual provider evidence",
      accountAlias: "Test alias",
      channel: "Manual",
      tolerance: 0,
      status: "PAUSED",
    };
    const rule = await R.saveRecurring(owner, { ...base(), ...input });
    const range = { from: "2025-01-01", to: "2025-12-31" };
    const preview = await R.backfillRecurring(owner, rule.id, {
      ...base(),
      ...range,
      preview: true,
    });
    assert.equal(preview.count, 12);
    await R.backfillRecurring(owner, rule.id, {
      ...base(),
      ...range,
      preview: false,
      expectedCount: 12,
    });
    await R.backfillRecurring(owner, rule.id, {
      ...base(),
      ...range,
      preview: false,
      expectedCount: 0,
    });
    assert.equal(
      await db.expense.count({ where: { recurringId: rule.id } }),
      12,
    );
    await runNotificationCheck(undefined, true);
    const notes = await db.notification.findMany({
      where: { objectType: "recurring", objectId: rule.id },
    });
    assert.equal(notes.length, 2);
    assert.ok(
      notes.every((n) => (n.currentData as { count: number }).count === 12),
    );
    pass(
      "Explicit historical preview/backfill creates 12 unique periods; retry creates none, and payment/outcome reminders each use one summary.",
    );
    const ex = await E.saveExpense(owner, {
      ...base(),
      title: "=Synthetic FX date check",
      categoryId: "other",
      purpose: "Date and cash-flow verification",
      payee: "Synthetic payee",
      assigneeId: owner.id,
      plannedAt: "2024-01-01",
      dueAt: "2024-01-02",
      timezone: "Asia/Shanghai",
      currency: "USD",
      amount: 1000,
      rateMicros: 1500000,
      rateDate: "2024-01-01",
      rateSource: "Synthetic agreed conversion",
      expectedResult: "Service outcome",
      resultDueAt: "2024-01-10",
      verificationMethod: "Manual proof",
      paymentMode: "MANUAL",
    });
    const cash = {
      kind: "PAYMENT",
      status: "CONFIRMED",
      currency: "USD",
      source: "MANUAL",
      accountAlias: "Synthetic account",
      channel: "Manual",
      rateMicros: 1500000,
      rateDate: "2024-01-01",
      rateSource: "Synthetic rate",
    };
    await E.recordCash(owner, ex.id, {
      ...base(),
      ...cash,
      amount: 300,
      occurredAt: "2024-01-03T03:00:00Z",
      reference: "early-" + randomUUID(),
    });
    await E.recordCash(owner, ex.id, {
      ...base(),
      ...cash,
      amount: 700,
      occurredAt: "2024-01-04T03:00:00Z",
      reference: "late-" + randomUUID(),
    });
    const report = await Q.expenses(owner, {
      q: "Synthetic FX date check",
      dateField: "paid",
      from: "2024-01-04",
      to: "2024-01-04",
    });
    assert.ok(typeof report !== "string");
    if (typeof report !== "string") {
      assert.equal(report.summary.USD.paid, 700);
      assert.equal(report.summary.USD.reportNet, 1050);
      assert.equal(report.summary.USD.reportObligation, 1500);
      assert.equal(report.summary.USD.missingRates, 0);
    }
    const csv = await Q.expenses(owner, {
      q: "Synthetic FX date check",
      format: "csv",
    });
    assert.ok(typeof csv === "string" && csv.includes("'=Synthetic"));
    let detail = await Q.expenseDetail(owner, ex.id);
    assert.equal(detail.resultStatus, "PENDING");
    await E.expenseAction(owner, ex.id, {
      ...base(),
      version: detail.version,
      action: "RESULT",
      evidence: "Synthetic actual activation evidence",
    });
    detail = await Q.expenseDetail(owner, ex.id);
    assert.equal(detail.resultStatus, "CONFIRMED");
    pass(
      "Cash-date filtering uses actual payment dates, explicit FX rounds to AUD minor units, CSV neutralizes formula prefixes, and payment alone does not confirm service activation.",
    );
    const record = await E.recordCash(owner, ex.id, {
      ...base(),
      ...cash,
      kind: "REFUND",
      amount: 200,
      occurredAt: "2024-01-05T03:00:00Z",
      reference: "refund-" + randomUUID(),
    });
    await E.recordCash(owner, ex.id, {
      ...base(),
      ...cash,
      kind: "REVERSAL",
      amount: 200,
      occurredAt: "2024-01-06T03:00:00Z",
      reference: "reversal-" + randomUUID(),
      correctionOf: record.cashId,
    });
    const refunded = await Q.expenses(owner, {
      q: "Synthetic FX date check",
      dateField: "paid",
      from: "2024-01-06",
      to: "2024-01-06",
    });
    assert.ok(typeof refunded !== "string");
    if (typeof refunded !== "string") {
      assert.equal(refunded.summary.USD.refund, -200);
      assert.equal(refunded.summary.USD.net, 200);
    }
    pass(
      "A refund reversal adjusts cash flow on its own actual occurrence date; the original history remains intact.",
    );
    await writeFile(
      ".local/business-edge-verification.json",
      JSON.stringify({ passed: true, checks }),
      { mode: 0o600 },
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(
    "Business edge verification failed:",
    e instanceof Error ? e.message : "unknown",
  );
  process.exitCode = 1;
});
