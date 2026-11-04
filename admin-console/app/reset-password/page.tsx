"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"parsing" | "ready" | "error">("parsing");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function establishSession() {
      const supabase = createClient();

      // Normal case: this page was reached via a Supabase recovery link
      // whose redirect target was actually this app -- @supabase/ssr's
      // browser client auto-parses #access_token/refresh_token from the URL
      // on load and already has a session by the time we check.
      const { data: existing } = await supabase.auth.getSession();
      if (existing.session) {
        setStatus("ready");
        return;
      }

      // Fallback: the recovery link redirected somewhere else (a
      // misconfigured Site URL), and the resulting #access_token=...&
      // refresh_token=...&type=recovery hash was copied here manually.
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
      const params = new URLSearchParams(hash);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");

      if (!access_token || !refresh_token) {
        setStatus("error");
        setError("No recovery session found in the URL. Request a new reset link and open it directly, or paste its full #access_token=...&refresh_token=... fragment after /reset-password here.");
        return;
      }

      const { error: setSessionError } = await supabase.auth.setSession({ access_token, refresh_token });
      if (setSessionError) {
        setStatus("error");
        setError(setSessionError.message);
        return;
      }

      // Clear the token out of the URL/history now that it's been consumed.
      window.history.replaceState(null, "", "/reset-password");
      setStatus("ready");
    }

    establishSession();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setDone(true);
    setTimeout(() => router.push("/dashboard"), 1500);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-ink">Reset password</h1>
          <p className="mt-1 text-sm text-muted">SmallBird AI Admin</p>
        </div>

        <div className="card">
          {status === "parsing" && <p className="text-sm text-muted">Verifying reset link...</p>}

          {status === "error" && (
            <div className="space-y-3">
              <p className="text-sm text-danger">{error}</p>
              <input
                placeholder="Paste #access_token=...&refresh_token=... here"
                className="input"
                onChange={async (e) => {
                  const params = new URLSearchParams(e.target.value.replace(/^#/, ""));
                  const access_token = params.get("access_token");
                  const refresh_token = params.get("refresh_token");
                  if (!access_token || !refresh_token) return;
                  const supabase = createClient();
                  const { error: setSessionError } = await supabase.auth.setSession({ access_token, refresh_token });
                  if (setSessionError) {
                    setError(setSessionError.message);
                    return;
                  }
                  setError(null);
                  setStatus("ready");
                }}
              />
            </div>
          )}

          {status === "ready" && !done && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-ink" htmlFor="password">
                  New password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink" htmlFor="confirm">
                  Confirm password
                </label>
                <input
                  id="confirm"
                  type="password"
                  required
                  autoComplete="new-password"
                  className="input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? "Saving..." : "Set new password"}
              </button>
            </form>
          )}

          {done && <p className="text-sm text-ok">Password updated. Redirecting...</p>}
        </div>
      </div>
    </div>
  );
}
