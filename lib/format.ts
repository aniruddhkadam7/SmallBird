// Renders a duration in seconds as "1h 2m 5s" / "2m 5s" / "45s" instead of
// a raw second count, which was hard to read at a glance for anything over
// a minute or two.
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
