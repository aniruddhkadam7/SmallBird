// Shown while a page's first admin-* request is in flight (and by
// (admin)/loading.tsx during route transitions), so switching tabs paints a
// skeleton immediately instead of a blank main area. If the request failed
// with something other than the 403/404 cases pages handle themselves, the
// error is shown instead of a skeleton that would spin forever.
export function PageLoading({ error }: { error?: unknown }) {
  if (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return <p className="text-sm text-danger">Couldn&apos;t load this page: {message}</p>;
  }

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
