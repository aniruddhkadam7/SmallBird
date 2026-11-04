import { FUNCTIONS_URL, LLM_MODEL, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import { getAccessToken, sessionFromTokenResponse, type AuthSession } from "./session";

/** `code` carries the backend's machine-readable reason (e.g. ACTIVE_SESSION_ELSEWHERE, SESSION_ENDED). */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: string; msg?: string; error_description?: string; code?: string };
    return new ApiError(body.error ?? body.msg ?? body.error_description ?? `Request failed (${res.status})`, res.status, body.code);
  } catch {
    return new ApiError(`Request failed (${res.status})`, res.status);
  }
}

async function network<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (err) {
    if (err instanceof ApiError || (err instanceof DOMException && err.name === "AbortError")) throw err;
    throw new ApiError("Couldn't reach SmallBird AI. Check your connection and try again.", 0);
  }
}

async function callFunction(name: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  const token = await getAccessToken();
  return network(
    fetch(`${FUNCTIONS_URL}/${name}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    }),
  );
}

// ---- Login (email OTP, same functions as the desktop app) -----------------

export async function requestOtp(email: string): Promise<void> {
  const res = await network(
    fetch(`${FUNCTIONS_URL}/request-otp`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }),
  );
  if (!res.ok) throw await toApiError(res);
}

export async function verifyOtp(email: string, code: string): Promise<AuthSession> {
  const res = await network(
    fetch(`${FUNCTIONS_URL}/verify-otp`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email, code, name: null }),
    }),
  );
  if (!res.ok) throw await toApiError(res);
  return sessionFromTokenResponse(await res.json(), email);
}

// ---- Account ---------------------------------------------------------------

export interface Entitlement {
  planId: string;
  remainingMinutes: number;
}

/** The admin's maintenance message while maintenance mode is on, else null. Never throws. */
export async function getMaintenanceMessage(): Promise<string | null> {
  try {
    const res = await fetch(`${FUNCTIONS_URL}/app-status`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { maintenance?: boolean; message?: string | null };
    return body.maintenance ? (body.message ?? "SmallBird AI is currently under maintenance. Please check back shortly.") : null;
  } catch {
    return null;
  }
}

export async function getEntitlement(): Promise<Entitlement> {
  const token = await getAccessToken();
  const res = await network(
    fetch(`${SUPABASE_URL}/rest/v1/entitlements?select=plan_id,remaining_minutes`, {
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    }),
  );
  if (!res.ok) throw await toApiError(res);
  const rows = (await res.json()) as { plan_id: string; remaining_minutes: number }[];
  if (!rows[0]) throw new ApiError("No plan found for this account", 404);
  return { planId: rows[0].plan_id, remainingMinutes: Number(rows[0].remaining_minutes) };
}

// ---- Interview session -----------------------------------------------------

export interface SttSession {
  sessionId: string;
  /** Short-lived, scoped Deepgram key — audio goes straight to Deepgram, never through our servers. */
  key: string;
  expiresInSeconds: number;
}

/** `force` ends an active session on another device and takes its place. */
export async function mintSttSession(force: boolean): Promise<SttSession> {
  const res = await callFunction("stt-token", { force });
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as SttSession;
}

/** Throws ApiError with code SESSION_ENDED once the session was ended elsewhere or expired. */
export async function sendHeartbeat(sessionId: string): Promise<void> {
  const res = await callFunction("session-heartbeat", { sessionId });
  if (!res.ok) throw await toApiError(res);
}

export async function reportUsage(sessionId: string, actualDurationSeconds: number): Promise<void> {
  const res = await callFunction("usage-report", { sessionId, actualDurationSeconds });
  if (!res.ok) throw await toApiError(res);
}

// ---- LLM (streamed through llm-proxy) --------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
  );
  if (!res.ok || !res.body) throw await toApiError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // A network chunk can end mid-line, so only consume complete lines.
    let boundary: number;
    while ((boundary = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) onDelta(delta);
      } catch {
        // A partial/keep-alive line — skip it.
      }
    }
  }
}
