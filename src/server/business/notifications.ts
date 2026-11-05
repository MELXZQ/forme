import "server-only";
import type { Issue } from "../notifications/engine";
import { localDay, dateBounds } from "../notifications/time";
import { cashTotals, plain, type Tx } from "./common";
import { remainingPurchase } from "./purchases";
export async function businessIssues(
  tx: Tx,
  graceDays: number,
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const expenses = await tx.expense.findMany({
    include: { cash: true, links: true },
  });
  const purchases = await tx.purchase.findMany({
    include: { lines: true, parcels: true },
  });
  const make = (
    key: string,
    type: Issue["type"],
    objectType: string,
    objectId: string,
    title: string,
    reason: string,
    data: Record<string, unknown>,
    pin = false,
    severity = 1,
  ): Issue => ({
    key,
    type,
    objectType,
    objectId,
    title,
    reason,
    action:
      "Open the linked business record, verify actual evidence and record the outcome. Confirmation alone does not resolve an exception.",
    data: plain(data),
    material: data,
    pin,
    severity,
  });
  for (const p of purchases) {
    if (p.status !== "CONFIRMED") continue;
    const pending = p.lines.reduce((n, l) => n + remainingPurchase(l), 0),
      zone =
        p.warehouse === "BEIJING" ? "Asia/Shanghai" : "Australia/Melbourne",
      today = localDay(new Date(), zone),
      e = expenses.find((e) => e.purchaseId === p.id),
      paid = cashTotals(e?.cash ?? []).paid;
    const end =
      p.etaEnd?.toISOString().slice(0, 10) ??
      p.parcels
        .map((x) => x.etaEnd?.toISOString().slice(0, 10))
        .filter((s): s is string => !!s)
        .sort()
        .at(-1);
    const due = end
      ? new Date(Date.parse(end) + graceDays * 86400000)
          .toISOString()
          .slice(0, 10)
      : null;
    if (pending && due && today > due) {
      const i = make(
        "purchase-arrival:" + p.id,
        "PROCUREMENT",
        "purchase",
        p.id,
        p.number + ": warehouse receipt not fully registered",
        "Expected arrival and grace period passed. This is the single shared purchase / expense / logistics delay issue; it does not prove the goods have not arrived.",
        {
          purchaseId: p.id,
          expenseId: e?.id ?? null,
          parcelIds: p.parcels.map((x) => x.id),
          pending,
          paid,
          currency: p.currency,
          etaEnd: end,
          due,
        },
        paid > 0,
        paid > 0 ? 2 : 1,
      );
      i.deadlineAt = new Date(dateBounds(due, zone).lt.getTime() - 1);
      issues.push(i);
    }
    if (pending && !end)
      issues.push(
        make(
          "purchase-date:" + p.id,
          "PROCUREMENT",
          "purchase",
          p.id,
          p.number + ": expected arrival needs recording",
          "No end of expected arrival has been recorded.",
          { pending },
        ),
      );
    const damaged = p.lines.reduce((n, l) => n + l.receivedUnavailable, 0),
      short = p.lines.reduce((n, l) => n + l.shortClosedQty, 0);
    if (damaged || short)
      issues.push(
        make(
          "purchase-difference:" + p.id,
          "PROCUREMENT",
          "purchase",
          p.id,
          p.number + ": receipt difference requires an outcome",
          "Recorded damage or explicitly confirmed unfulfilled units require an outcome. Partial receipt alone is not a shortage.",
          { damaged, confirmedShort: short },
          true,
          2,
        ),
      );
  }
  for (const e of expenses) {
    if (e.status === "CANCELLED") {
      const i = make(
        "expense-cancel:" + e.id,
        "FINANCE",
        "expense",
        e.id,
        e.number + ": obligation cancelled",
        "The obligation was explicitly cancelled; prior cash history is retained.",
        { status: e.status },
        false,
        0,
      );
      i.actionable = false;
      issues.push(i);
      continue;
    }
    const totals = cashTotals(e.cash),
      today = localDay(
        new Date(),
        e.timezone as "Asia/Shanghai" | "Australia/Melbourne",
      ),
      due = e.dueAt.toISOString().slice(0, 10),
      grace = new Date(
        Date.parse(e.resultDueAt.toISOString().slice(0, 10)) +
          e.graceDays * 86400000,
      )
        .toISOString()
        .slice(0, 10),
      days = Math.floor((Date.parse(due) - Date.parse(today)) / 86400000);
    const outstanding = Math.max(0, e.amount - totals.paid);
    if (outstanding && days <= e.reminderDays)
      issues.push(
        make(
          "expense-due:" + e.id,
          "FINANCE",
          "expense",
          e.id,
          e.number +
            ": " +
            (e.paymentMode === "PROVIDER_AUTO"
              ? "automatic charge needs verification"
              : days < 0
                ? "payment overdue"
                : days === 0
                  ? "payment due"
                  : "payment approaching"),
          e.paymentMode === "PROVIDER_AUTO"
            ? "No confirmed cash record is available. A scheduled automatic charge is not proof of success or failure."
            : "A payment obligation is due; no bank or payment service was contacted.",
          {
            due,
            outstanding,
            currency: e.currency,
            paymentMode: e.paymentMode,
          },
          e.categoryId === "domain" && days < 0,
          days < 0 ? 2 : 1,
        ),
      );
    if (!e.purchaseId && e.resultStatus !== "CONFIRMED" && today > grace)
      issues.push(
        make(
          "expense-result:" + e.id,
          "FINANCE",
          "expense",
          e.id,
          e.number + ": expected result not confirmed",
          "Payment and service activation are separate. Record evidence of the expected result; no external service status is known.",
          {
            expectedResult: e.expectedResult,
            paid: totals.paid,
            currency: e.currency,
            due: grace,
          },
          true,
          2,
        ),
      );
    if (totals.paid > e.amount + e.tolerance)
      issues.push(
        make(
          "expense-tolerance:" + e.id,
          "FINANCE",
          "expense",
          e.id,
          e.number + ": recorded payment exceeds tolerance",
          "Actual recorded payments exceed the obligation plus the configured absolute tolerance.",
          {
            paid: totals.paid,
            amount: e.amount,
            tolerance: e.tolerance,
            currency: e.currency,
          },
          true,
          2,
        ),
      );
    if (
      e.expectedRefund > totals.refund &&
      e.refundDueAt &&
      today > e.refundDueAt.toISOString().slice(0, 10)
    )
      issues.push(
        make(
          "expense-refund:" + e.id,
          "FINANCE",
          "expense",
          e.id,
          e.number + ": agreed refund not yet recorded",
          "A supplier return is not evidence of receiving a refund.",
          {
            expected: e.expectedRefund,
            received: totals.refund,
            due: e.refundDueAt.toISOString(),
            currency: e.currency,
          },
          true,
          2,
        ),
      );
    for (const c of e.cash) {
      if (c.source === "TEST" || e.cash.some((x) => x.correctionOf === c.id))
        continue;
      if (c.status === "FAILED")
        issues.push(
          make(
            "cash-failed:" + c.id,
            "FINANCE",
            "expense",
            e.id,
            e.number + ": payment failure recorded",
            "An administrator explicitly recorded a failure; no unverified failure cause has been inferred.",
            {
              cashId: c.id,
              amount: c.amount,
              currency: c.currency,
              reference: c.reference,
            },
            true,
            2,
          ),
        );
      else if (c.kind !== "REVERSAL") {
        const i = make(
          "cash-event:" + c.id,
          "FINANCE",
          "expense",
          e.id,
          e.number +
            ": " +
            (c.kind === "PAYMENT" ? "payment" : "refund") +
            " manually recorded",
          "A staff member registered an actual event. This is not an API verification or an automatic transfer.",
          {
            cashId: c.id,
            amount: c.amount,
            currency: c.currency,
            source: c.source,
          },
          false,
          0,
        );
        i.actionable = false;
        i.occurredAt = c.occurredAt;
        i.initiatorId = c.actorId;
        issues.push(i);
      }
    }
  }
  const parcels = await tx.parcel.findMany();
  for (const p of parcels) {
    const today = localDay(
      new Date(),
      p.timezone as "Asia/Shanghai" | "Australia/Melbourne",
    );
    if (
      !p.purchaseId &&
      !p.transferId &&
      !["SIGNED", "LOST", "RETURNED"].includes(p.transportStatus) &&
      p.etaEnd &&
      today >
        new Date(p.etaEnd.getTime() + graceDays * 86400000)
          .toISOString()
          .slice(0, 10)
    )
      issues.push(
        make(
          "parcel-arrival:" + p.id,
          "LOGISTICS",
          "parcel",
          p.id,
          p.number + ": delivery not registered",
          "No manual delivery event is recorded after the destination ETA and grace period. This is not proof of actual non-delivery.",
          {
            etaEnd: p.etaEnd.toISOString(),
            transportStatus: p.transportStatus,
          },
          true,
          2,
        ),
      );
    if (p.exception)
      issues.push(
        make(
          "parcel-exception:" + p.id,
          "LOGISTICS",
          "parcel",
          p.id,
          p.number + ": transport exception",
          "A transport exception was explicitly registered. Inventory remains controlled by the related receiving or fulfilment service.",
          { exception: p.exception, transportStatus: p.transportStatus },
          true,
          2,
        ),
      );
  }
  for (const i of issues.filter((i) => i.objectType === "parcel")) {
    const p = parcels.find((p) => p.id === i.objectId);
    if (p?.warehouse) i.warehouse = p.warehouse as "BEIJING" | "MELBOURNE";
  }
  // Large historical recurring backfills share one stable summary per rule/type.
  for (const ruleId of new Set(
    expenses.filter((e) => e.recurringId).map((e) => e.recurringId!),
  )) {
    for (const prefix of ["expense-due:", "expense-result:"]) {
      const ids = new Set(
        expenses.filter((e) => e.recurringId === ruleId).map((e) => e.id),
      );
      const grouped = issues.filter(
        (i) => i.key.startsWith(prefix) && ids.has(i.objectId),
      );
      if (grouped.length > 5) {
        for (const i of grouped) issues.splice(issues.indexOf(i), 1);
        issues.push(
          make(
            "recurring-summary:" + ruleId + ":" + prefix,
            "FINANCE",
            "recurring",
            ruleId,
            grouped.length +
              " recurring periods need " +
              (prefix === "expense-due:"
                ? "payment verification"
                : "outcome verification"),
            "Historical periods are summarized; open the rule for its individual expense records.",
            {
              expenseIds: grouped.map((i) => i.objectId).sort(),
              count: grouped.length,
            },
            grouped.some((i) => i.pin),
            2,
          ),
        );
      }
    }
  }
  return issues;
}
