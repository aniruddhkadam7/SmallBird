// Thin wrapper around calling an admin-* Edge Function. Every call carries
// the signed-in user's own access token as a Bearer token -- that token is
// re-verified and re-checked against the admin_users allowlist inside the
// function on every single call (see backend/supabase/functions/_shared/
// admin.ts's requireAdmin()). Nothing here decides authorization; it only
// forwards the caller's identity.
const FUNCTIONS_URL = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1`;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export class AdminApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function callAdminFunction<T>(
  accessToken: string,
  functionName: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${FUNCTIONS_URL}/${functionName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new AdminApiError(res.status, payload?.error ?? `Request to ${functionName} failed`);
  }

  return payload as T;
}
