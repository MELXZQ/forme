export type CycleRule = { anchorDate: Date; unit: string; interval: number };
export function cycleDate(rule: CycleRule, index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 100000)
    throw new Error("Invalid cycle index");
  const anchor = rule.anchorDate,
    y = anchor.getUTCFullYear(),
    m = anchor.getUTCMonth(),
    d = anchor.getUTCDate(),
    n = index * rule.interval;
  if (rule.unit === "DAY" || rule.unit === "WEEK")
    return new Date(Date.UTC(y, m, d + n * (rule.unit === "WEEK" ? 7 : 1)))
      .toISOString()
      .slice(0, 10);
  const year = y + (rule.unit === "YEAR" ? n : Math.floor((m + n) / 12)),
    month = rule.unit === "YEAR" ? m : (m + n) % 12;
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(d, new Date(Date.UTC(year, month + 1, 0)).getUTCDate()),
    ),
  )
    .toISOString()
    .slice(0, 10);
}
export function indexAtOrAfter(rule: CycleRule, day: string) {
  const target = new Date(day + "T00:00:00Z"),
    a = rule.anchorDate;
  const difference =
    rule.unit === "YEAR"
      ? target.getUTCFullYear() - a.getUTCFullYear()
      : rule.unit === "MONTH"
        ? (target.getUTCFullYear() - a.getUTCFullYear()) * 12 +
          target.getUTCMonth() -
          a.getUTCMonth()
        : Math.floor((target.getTime() - a.getTime()) / 86400000) /
          (rule.unit === "WEEK" ? 7 : 1);
  let index = Math.max(0, Math.floor(difference / rule.interval));
  while (index > 0 && cycleDate(rule, index - 1) >= day) index--;
  while (cycleDate(rule, index) < day) index++;
  return index;
}
