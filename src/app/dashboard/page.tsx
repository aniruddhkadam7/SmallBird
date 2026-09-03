// The actual content renders from the layout above -- it needs the same
// `user` the entitlement/transcripts queries do, and fetching everything
// there (concurrently) avoids the extra network round-trip a separate
// fetch here would waterfall behind. This file exists only so /dashboard
// is a real route.
export default function DashboardPage() {
  return null
}
