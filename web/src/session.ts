import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds after which the access token must be refreshed. */
  expiresAt: number;
  email: string;
}

const STORAGE_KEY = "smallbird:web-session";
/** Refresh 60s early so a call in flight doesn't race the expiry (same margin as the desktop app). */
const REFRESH_MARGIN_S = 60;

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: { email?: string | null };
}

const now = () => Math.floor(Date.now() / 1000);

export function loadSession(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

function saveSession(session: AuthSession | null): void {
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode / blocked storage: the session just won't survive a reload.
  }
}

export function sessionFromTokenResponse(body: TokenResponse, fallbackEmail: string): AuthSession {
  const session: AuthSession = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: now() + body.expires_in,
    email: body.user?.email ?? fallbackEmail,
  };
  saveSession(session);
  return session;
}

export function signOut(): void {
  saveSession(null);
}

// Refresh tokens are single-use, so two concurrent refreshes (a heartbeat and
// an LLM call landing together) would make the second one fail and log the
// user out mid-interview. Share one in-flight refresh instead.
let inflightRefresh: Promise<AuthSession> | null = null;

async function refresh(current: AuthSession): Promise<AuthSession> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: current.refreshToken }),
  });
  if (!res.ok) {
    // A rejected refresh token means the login is dead; don't keep retrying it.
    signOut();
    throw new Error("Your session expired. Please sign in again.");
  }
  return sessionFromTokenResponse((await res.json()) as TokenResponse, current.email);
}

/** Returns a valid access token, refreshing it first when it's about to expire. */
export async function getAccessToken(): Promise<string> {
  const current = loadSession();
  if (!current) throw new Error("Please sign in.");
  if (now() < current.expiresAt - REFRESH_MARGIN_S) return current.accessToken;

  inflightRefresh ??= refresh(current).finally(() => {
    inflightRefresh = null;
  });
  return (await inflightRefresh).accessToken;
}
