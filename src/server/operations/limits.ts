import "server-only";
import { HttpError } from "../errors";
const globalLimits = globalThis as unknown as {
  formeGuestLimits?: Map<string, { start: number; count: number }>;
};
export function guestLimit(path: string, max = 30) {
  const limits = (globalLimits.formeGuestLimits ??= new Map());
  const now = Date.now(),
    old = limits.get(path);
  if (!old || now - old.start >= 60000) {
    limits.set(path, { start: now, count: 1 });
    return;
  }
  if (++old.count > max)
    throw new HttpError(
      429,
      "Too many requests. Wait one minute and try again.",
    );
}
