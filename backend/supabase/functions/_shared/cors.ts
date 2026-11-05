// CORS for the functions the web/mobile interview page calls straight from a
// browser (request-otp, verify-otp, stt-token, session-heartbeat,
// usage-report, llm-proxy). The desktop app calls the same functions from
// native code, sends no `Origin` header, and never needed this — so a request
// with no (or an unlisted) Origin is passed through untouched and simply gets
// no CORS headers, which is exactly what it got before.
//
// Unlike the admin-* functions' open `*` (see admin.ts), these are
// restricted to known origins: request-otp is reachable without a JWT, and
// there's no reason for an arbitrary site to be able to drive it from a
// visitor's browser. The WEB_ALLOWED_ORIGINS secret (comma-separated) ADDS
// origins (a preview site, local dev); it can never remove our own domains.
// It used to replace the whole list, so a value set before the move to
// smallbirdai.com silently blocked the resume builder and the phone page
// ("Couldn't reach SmallBird AI") on the new domain.

const FIRST_PARTY_ORIGINS = [
  "https://smallbirdai.com",
  "https://www.smallbirdai.com",
  "https://smallbird.in",
  "https://www.smallbird.in",
];

const DEV_ORIGINS = ["http://localhost:5173", "http://localhost:4173"];

function allowedOrigins(): string[] {
  const configured = Deno.env.get("WEB_ALLOWED_ORIGINS");
  const extra = configured ? configured.split(",").map((o) => o.trim()).filter(Boolean) : DEV_ORIGINS;
  return [...FIRST_PARTY_ORIGINS, ...extra];
}

function corsHeadersFor(req: Request): Headers {
  const headers = new Headers();
  const origin = req.headers.get("Origin");
  if (origin && allowedOrigins().includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Max-Age", "86400");
    headers.append("Vary", "Origin");
  }
  return headers;
}

export function withCors(handler: (req: Request) => Response | Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const cors = corsHeadersFor(req);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const response = await handler(req);

    // Rebuilt rather than mutated: a Response that came straight from
    // fetch() (llm-proxy streams the provider's response through) has
    // immutable headers. The body stream is passed through as-is, so
    // streaming is unaffected.
    const headers = new Headers(response.headers);
    cors.forEach((value, key) => headers.set(key, value));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
}
