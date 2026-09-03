// Next.js shows this automatically the instant /dashboard is clicked,
// while the layout's getUser + entitlement + transcripts fetch is still in
// flight -- before this existed, that same network wait just looked like
// the click didn't register at all, since nothing rendered until every
// query resolved.
export default function DashboardLoading() {
  return (
    <div className="dark flex min-h-screen animate-pulse bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col gap-6 border-r border-border bg-background px-4 py-5">
        <div className="h-6 w-32 rounded bg-foreground/10" />
        <div className="h-8 w-full rounded-md bg-foreground/10" />
        <div className="mt-auto flex flex-col gap-3">
          <div className="h-24 rounded-lg border border-border bg-card" />
          <div className="h-8 w-full rounded-md bg-foreground/10" />
          <div className="h-8 w-full rounded-md bg-foreground/10" />
        </div>
      </aside>
      <div className="flex-1 px-8 py-10">
        <div className="mx-auto max-w-5xl">
          <div className="h-7 w-40 rounded bg-foreground/10" />
          <div className="mt-3 h-4 w-72 rounded bg-foreground/10" />
          <div className="mt-8 h-32 rounded-xl border border-border bg-card" />
        </div>
      </div>
    </div>
  )
}
