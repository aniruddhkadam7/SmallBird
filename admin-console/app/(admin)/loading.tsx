// Next.js shows this immediately on navigation, before the destination
// route's shell mounts -- without it, clicking a nav tab just leaves the old
// page on screen (looking frozen) while that happens.
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-40 animate-pulse rounded bg-ink/10" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card h-20 animate-pulse bg-ink/5" />
        ))}
      </div>
      <div className="table-wrap h-64 animate-pulse bg-ink/5" />
    </div>
  );
}
