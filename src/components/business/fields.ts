import { type Field, choices, pick } from "./forms";
import { type Row, list, str } from "../operations/ui";
export const f = (
  name: string,
  label: string,
  type: Field["type"] = "text",
  required = false,
): Field => ({ name, label, type, required });
export const select = (
  name: string,
  label: string,
  values: string[],
  required = true,
): Field => ({
  ...f(name, label, "select", required),
  options: choices(values),
});
export const currency = select("currency", "Original currency", [
  "AUD",
  "CNY",
  "USD",
  "EUR",
  "GBP",
]);
export const timezone = select("timezone", "Business timezone", [
  "Asia/Shanghai",
  "Australia/Melbourne",
]);
export const warehouse = select("warehouse", "Receiving warehouse", [
  "BEIJING",
  "MELBOURNE",
]);
export const reference = f(
  "reference",
  "Unique external / acceptance reference",
  "text",
  true,
);
export const occurred = f(
  "occurredAt",
  "Actual event time (your local time)",
  "datetime",
  true,
);
export const people = (meta: Row): Field => ({
  ...f("assigneeId", "Responsible person", "select", true),
  options: pick(list(meta.people)),
});
export const category = (meta: Row): Field => ({
  ...f("categoryId", "Expense category", "select", true),
  options: pick(list(meta.categories)),
});
export const supplier = (meta: Row, required = true): Field => ({
  ...f("supplierId", "Supplier", "select", required),
  options: pick(list(meta.suppliers)),
});
export const rateFields: Field[] = [
  f("rateMicros", "1 original currency unit = AUD", "rate"),
  f("rateDate", "Exchange rate date", "date"),
  f("rateSource", "Exchange rate source"),
];
export const supplierFields: Field[] = [
  f("code", "Internal supplier code", "text", true),
  f("name", "Supplier name", "text", true),
  f("contact", "Contact person"),
  f("contactDetails", "Contact details", "textarea"),
  f("website", "Platform / website URL"),
  currency,
  f("notes", "Notes", "textarea"),
  f("archived", "Archived", "checkbox"),
];
export const purchaseFields = (meta: Row): Field[] => [
  supplier(meta),
  people(meta),
  warehouse,
  occurredPurchase,
  f("etaStart", "Expected arrival from", "date"),
  f("etaEnd", "Expected arrival by", "date"),
  currency,
  f("discount", "Discount", "amount", true),
  f("domesticShipping", "Included domestic shipping", "amount", true),
  f("otherFees", "Other included fees", "amount", true),
  f("notes", "Notes", "textarea"),
  f(
    "acknowledgePayments",
    "I reviewed existing payment history before this revision",
    "checkbox",
  ),
];
const occurredPurchase = {
  ...occurred,
  name: "orderedAt",
  label: "Order placed at (your local time)",
};
export const expenseFields = (meta: Row): Field[] => [
  f("title", "Expense name", "text", true),
  category(meta),
  f("purpose", "Purpose", "textarea", true),
  f("payee", "Payee / service provider", "text", true),
  supplier(meta, false),
  people(meta),
  f("plannedAt", "Planned date", "date", true),
  f("dueAt", "Payment due date", "date", true),
  timezone,
  currency,
  f("amount", "Obligation amount", "amount", true),
  ...rateFields,
  f("accountAlias", "Payment account alias (no passwords or card numbers)"),
  f("channel", "Payment channel"),
  f("expectedResult", "Expected delivery / service outcome", "textarea", true),
  f("resultDueAt", "Outcome due date", "date", true),
  f("verificationMethod", "How to verify the outcome", "text", true),
  select("paymentMode", "Payment method", ["MANUAL", "PROVIDER_AUTO"]),
  f("tolerance", "Overpayment tolerance", "amount", true),
  f("graceDays", "Grace days", "number"),
  f("reminderDays", "Reminder days before due", "number"),
  f("notes", "Notes", "textarea"),
  f(
    "acknowledgePayments",
    "I reviewed existing cash records before this revision",
    "checkbox",
  ),
];
export const recurringFields = (meta: Row): Field[] => [
  f("name", "Rule name", "text", true),
  f("payee", "Service provider", "text", true),
  category(meta),
  people(meta),
  currency,
  f("amount", "Expected amount per period", "amount", true),
  select("unit", "Period unit", ["DAY", "WEEK", "MONTH", "YEAR"]),
  f("interval", "Every N periods", "number", true),
  f("anchorDate", "Original anchor date", "date", true),
  f("endDate", "Optional end date", "date"),
  timezone,
  f("reminderDays", "Reminder days", "number"),
  f("graceDays", "Grace days", "number"),
  select("paymentMode", "Payment method", ["MANUAL", "PROVIDER_AUTO"]),
  f("expectedResult", "Expected service outcome", "textarea", true),
  f("verificationMethod", "How to verify", "text", true),
  f("accountAlias", "Account alias"),
  f("channel", "Channel"),
  f("tolerance", "Overpayment tolerance", "amount", true),
  select("status", "Rule state", ["ACTIVE", "PAUSED", "ENDED"]),
  {
    ...f("resumeFrom", "Explicit resume date", "date"),
    help: "Required when restarting a paused or ended rule. Today or later; use Backfill for past periods.",
  },
];
export const recordOptions = (rows: Row[], key = "number") =>
  rows.map((r) => ({ value: str(r.id), label: str(r[key]) }));
