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

// "today, 3:45 pm" / "yesterday, 9:10 am" / "24 Oct" (adds the year when it
// isn't this year) -- for when someone signed up, in the viewer's time zone.
export function formatJoined(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  if (days === 0) return `today, ${time}`;
  if (days === 1) return `yesterday, ${time}`;
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
