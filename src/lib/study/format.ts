// Short relative-time labels for the four rating-button subtitles.
// Sub-hour intervals render as "<Nm", sub-day as "<Nh", sub-month as "~Nd",
// longer as "~Nmo". "mo" disambiguates from "m" minutes.
export function relativeShort(iso: string, now: Date = new Date()): string {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return "—";
  const absMs = Math.abs(target - now.getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (absMs < hour) {
    const minutes = Math.max(1, Math.round(absMs / minute));
    return `<${minutes}m`;
  }
  if (absMs < day) {
    const hours = Math.max(1, Math.round(absMs / hour));
    return `<${hours}h`;
  }
  if (absMs < 30 * day) {
    const days = Math.max(1, Math.round(absMs / day));
    return `~${days}d`;
  }
  const months = Math.max(1, Math.round(absMs / (30 * day)));
  return `~${months}mo`;
}
