import { createClient } from "@/lib/supabase/client"

// The mobile page lives on smallbirdai.com and reuses the website's own login:
// the Supabase session is the same cookie the rest of the site (dashboard,
// download) already uses, so there is no second sign-in. supabase-js
// refreshes an expired access token itself inside getSession().
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`

// Same model the desktop app's Ask AI uses for OpenAI.
const LLM_MODEL = "gpt-4o"

/** `code` carries the backend's machine-readable reason (e.g. ACTIVE_SESSION_ELSEWHERE, SESSION_ENDED). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "")
  try {
    const body = JSON.parse(text) as { error?: string; msg?: string; code?: string }
    return new ApiError(body.error ?? body.msg ?? `Request failed (${res.status})`, res.status, body.code)
  } catch {
    return new ApiError(`Request failed (${res.status})`, res.status)
  }
}

async function network<T>(request: Promise<T>): Promise<T> {
  try {
    return await request
  } catch (err) {
    if (err instanceof ApiError || (err instanceof DOMException && err.name === "AbortError")) throw err
    throw new ApiError("Couldn't reach SmallBird AI. Check your connection and try again.", 0)
  }
}

async function getAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await createClient().auth.getSession()
  if (!session) throw new ApiError("Please sign in again.", 401, "NOT_SIGNED_IN")
  return session.access_token
}

async function callFunction(name: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const token = await getAccessToken()
  return network(
    fetch(`${FUNCTIONS_URL}/${name}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
  )
}

// ---- Account ---------------------------------------------------------------

export interface Entitlement {
  planId: string
  remainingMinutes: number
}

export async function getEntitlement(): Promise<Entitlement> {
  // RLS scopes this to the signed-in user's own row.
  const { data, error } = await createClient().from("entitlements").select("plan_id, remaining_minutes").single()
  if (error || !data) throw new ApiError("Couldn't load your plan.", 404)
  return { planId: data.plan_id as string, remainingMinutes: Number(data.remaining_minutes) }
}

// ---- Interview session -----------------------------------------------------

export interface SttSession {
  sessionId: string
  /** Short-lived, scoped Deepgram key — audio goes straight to Deepgram, never through our servers. */
  key: string
  expiresInSeconds: number
}

/** `force` ends an active session on another device and takes its place. */
export async function mintSttSession(force: boolean): Promise<SttSession> {
  const res = await callFunction("stt-token", { force })
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as SttSession
}

/** Throws ApiError with code SESSION_ENDED once the session was ended elsewhere or expired. */
export async function sendHeartbeat(sessionId: string): Promise<void> {
  const res = await callFunction("session-heartbeat", { sessionId })
  if (!res.ok) throw await toApiError(res)
}

export async function reportUsage(sessionId: string, actualDurationSeconds: number): Promise<void> {
  const res = await callFunction("usage-report", { sessionId, actualDurationSeconds })
  if (!res.ok) throw await toApiError(res)
}

// ---- LLM (streamed through llm-proxy) --------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

/** Streams an OpenAI chat completion through llm-proxy, calling `onDelta` per text chunk. */
export async function streamChat(
  messages: ChatMessage[],
  maxTokens: number,
  sessionId: string,
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await callFunction(
    "llm-proxy",
    {
      provider: "openai",
      requestKind: "web_ask",
      sessionId,
      payload: { model: LLM_MODEL, messages, temperature: 0.4, max_tokens: maxTokens, stream: true },
    },
    signal,
  )
  if (!res.ok || !res.body) throw await toApiError(res)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // A network chunk can end mid-line, so only consume complete lines.
    let boundary: number
    while ((boundary = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, boundary).trim()
      buffer = buffer.slice(boundary + 1)
      if (!line.startsWith("data:")) continue
      const data = line.slice(5).trim()
      if (data === "[DONE]") return
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content
        if (typeof delta === "string" && delta) onDelta(delta)
      } catch {
        // A partial/keep-alive line — skip it.
      }
    }
  }
}
