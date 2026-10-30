import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Receives the site's own tracking calls (lib/analytics.ts) and passes them
// to the backend's `track` Edge Function with what only the server knows:
// Vercel's rough location for the visitor, their IP (for rate limiting
// only, not stored) and user agent, and the signed-in user's access token so
// their visits can be tied to their account. Always answers 204 -- tracking
// must never show an error to a visitor.

const TRACK_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/track`

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    if (body.length > 8_000) return new NextResponse(null, { status: 204 })

    let token: string | undefined
    if (/"type":"(view|event)"/.test(body)) {
      const supabase = await createClient()
      const { data } = await supabase.auth.getSession()
      token = data.session?.access_token
    }

    const h = req.headers
    const forward: Record<string, string> = {
      "content-type": "application/json",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
      "x-visitor-ua": h.get("user-agent") ?? "",
      "x-visitor-ip": (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown",
    }
    for (const [from, to] of [
      ["x-vercel-ip-country", "x-visitor-country"],
      ["x-vercel-ip-country-region", "x-visitor-region"],
      ["x-vercel-ip-city", "x-visitor-city"],
    ] as const) {
      const v = h.get(from)
      if (v) forward[to] = v
    }
    if (token) forward["x-user-token"] = token

    await fetch(TRACK_URL, { method: "POST", headers: forward, body, cache: "no-store" })
  } catch {
    // Ignore -- see above.
  }
  return new NextResponse(null, { status: 204 })
}
