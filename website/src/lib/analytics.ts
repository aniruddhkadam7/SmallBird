// First-party traffic tracking for the admin console's Analytics page. Every
// page view, how long it stayed open, and key clicks go to /api/track, which
// hands them to the backend's `track` Edge Function (web_events table,
// SmallBird-Local-exe migration 0063). Vercel Analytics stays on as well;
// its numbers just can't be read from the admin console.
//
// visitorId: a random id kept in localStorage, so a returning visitor is the
// same visitor. sessionId: one visit, ended after 30 minutes without a page
// view. Nothing personal is sent; if the visitor is signed in, /api/track
// adds that from the session cookie.

const VISITOR_KEY = "sb-visitor-id"
const SESSION_KEY = "sb-session"
const SESSION_IDLE_MS = 30 * 60 * 1000
const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const

function uuid(): string {
  return crypto.randomUUID()
}

function enabled(): boolean {
  if (typeof window === "undefined") return false
  const host = window.location.hostname
  return host !== "localhost" && !host.startsWith("127.") && !host.startsWith("192.168.")
}

function visitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = uuid()
      localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    return uuid()
  }
}

/** The current visit's id, and whether this page view starts a new visit. */
function session(): { id: string; isNew: boolean } {
  const now = Date.now()
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as { id: string; at: number } | null
    const isNew = !saved || now - saved.at > SESSION_IDLE_MS
    const id = isNew ? uuid() : saved.id
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, at: now }))
    return { id, isNew }
  } catch {
    return { id: uuid(), isNew: true }
  }
}

function send(payload: Record<string, unknown>, beacon = false) {
  const body = JSON.stringify(payload)
  if (beacon && navigator.sendBeacon) {
    navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }))
    return
  }
  fetch("/api/track", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {})
}

let current: { id: string; startedAt: number } | null = null

/** Sends how long the last page was open (on navigation or when the tab hides). */
export function endPageView() {
  if (!current || !enabled()) return
  send({ type: "leave", id: current.id, visitorId: visitorId(), durationMs: Date.now() - current.startedAt }, true)
  current = null
}

export function trackPageView(path: string, search: URLSearchParams) {
  if (!enabled()) return
  endPageView()
  const { id: sessionId, isNew } = session()
  const id = uuid()
  current = { id, startedAt: Date.now() }

  // Where the visit came from only matters on its first page.
  let referrer: string | undefined
  if (isNew && document.referrer) {
    try {
      if (new URL(document.referrer).hostname !== window.location.hostname) referrer = document.referrer
    } catch {
      // Not a URL -- leave it out.
    }
  }
  const utm = Object.fromEntries(
    UTM_KEYS.map((k) => [k, search.get(`utm_${k}`) ?? (k === "source" ? search.get("ref") : null)]).filter(([, v]) => v),
  )

  send({
    type: "view",
    id,
    visitorId: visitorId(),
    sessionId,
    path,
    referrer,
    utm: Object.keys(utm).length ? utm : undefined,
  })
}

/** A key action, e.g. "download_windows" or "buy_start_pro". */
export function trackEvent(name: string) {
  if (!enabled()) return
  send({
    type: "event",
    id: uuid(),
    visitorId: visitorId(),
    sessionId: session().id,
    path: window.location.pathname,
    name,
  })
}
