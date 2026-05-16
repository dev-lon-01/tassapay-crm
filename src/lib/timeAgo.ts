/**
 * Human-friendly relative time. Buckets:
 *   < 60s        → "just now"
 *   < 60m        → "Xm ago"
 *   < 24h        → "Xh ago"
 *   < 48h        → "Yesterday"
 *   < 7 days     → "Xd ago"
 *   otherwise    → "DD MMM HH:mm" absolute
 */
export function formatTimeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";

  const now = Date.now();
  const diffMs = now - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  if (hr < 48) return "Yesterday";

  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;

  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
