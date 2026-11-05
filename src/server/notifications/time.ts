export type NotificationZone = "Australia/Melbourne" | "Asia/Shanghai";
export function localDay(date: Date, timezone: NotificationZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (kind: string) => parts.find((p) => p.type === kind)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function dateBounds(day: string, timezone: NotificationZone) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(day)) ||
    new Date(day).toISOString().slice(0, 10) !== day
  )
    throw new Error("Invalid calendar date");
  const first = (target: string) => {
    let lo = Date.parse(target) - 36 * 3600000,
      hi = Date.parse(target) + 36 * 3600000;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (localDay(new Date(mid), timezone) < target) lo = mid + 1;
      else hi = mid;
    }
    return new Date(lo);
  };
  return {
    gte: first(day),
    lt: first(new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10)),
  };
}
