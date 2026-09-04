import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Button } from "./ui";
import {
  getAuthSession,
  getEntitlement,
  loginWithGoogle,
  logout,
  requestLoginOtp,
  verifyLoginOtp,
  type AuthSessionInfo,
  type EntitlementInfo,
} from "./auth";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

type Step = "LOADING" | "EMAIL" | "CODE" | "LOGGED_IN";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  "interview-pass": "Interview Pass",
  "pro-monthly": "Pro Monthly",
  "pro-annual": "Pro Annual",
};

function formatMinutes(minutes: number): string {
  const whole = Math.floor(minutes);
  const hours = Math.floor(whole / 60);
  const mins = whole % 60;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

/// Passwordless email-OTP login against the same Supabase account used by
/// the website — send a code, enter the code, done. Every AI feature
/// requires a signed-in session (see start_backend_session's Rust-side
/// rejection when `current_access_token` finds none), so this is the one
/// place that session is established.
export function Account({ onClose, onSessionChange }: { onClose: () => void; onSessionChange?: (session: AuthSessionInfo) => void }) {
  const [step, setStep] = useState<Step>("LOADING");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loggedInEmail, setLoggedInEmail] = useState<string | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementInfo | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAuthSession()
      .then((session) => {
        if (cancelled) return;
        onSessionChange?.(session);
        if (session.loggedIn) {
          setLoggedInEmail(session.email);
          setStep("LOGGED_IN");
          getEntitlement()
            .then((info) => !cancelled && setEntitlement(info))
            .catch(() => {});
        } else {
          setStep("EMAIL");
        }
      })
      .catch(() => !cancelled && setStep("EMAIL"));
    return () => {
      cancelled = true;
    };
  }, [onSessionChange]);

  const handleGoogleLogin = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const session = await loginWithGoogle();
      onSessionChange?.(session);
      setLoggedInEmail(session.email);
      setStep("LOGGED_IN");
      getEntitlement()
        .then(setEntitlement)
        .catch(() => {});
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, [onSessionChange]);

  const handleSendCode = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await requestLoginOtp(trimmed);
      setStep("CODE");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, [email]);

  const handleVerify = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const session = await verifyLoginOtp(email.trim(), trimmed, name.trim());
      onSessionChange?.(session);
      setLoggedInEmail(session.email);
      setStep("LOGGED_IN");
      getEntitlement()
        .then(setEntitlement)
        .catch(() => {});
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, [email, code, onSessionChange]);

  const handleLogout = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await logout();
      onSessionChange?.({ loggedIn: false, email: null });
      setLoggedInEmail(null);
      setEntitlement(null);
      setEmail("");
      setCode("");
      setStep("EMAIL");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, [onSessionChange]);

  return (
    <div className="popover-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="popover" role="dialog" aria-modal="true" aria-label="Account">
        <div className="popover-header">
          <span className="setup-section-label">Account</span>
          <button className="modal-close-btn" onClick={onClose} title="Close" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="popover-body">
          {step === "LOADING" && <p className="setup-hint">Checking your session…</p>}

          {step === "EMAIL" && (
            <>
              <p className="setup-hint">
                Log in with your Smallbird account to use Interview Mode and Notes. We'll email you a 6-digit
                code — no password needed.
              </p>
              <div style={{ marginTop: "12px" }}>
                <Button
                  variant="ghost"
                  onClick={handleGoogleLogin}
                  disabled={busy}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", width: "100%" }}
                >
                  <GoogleIcon />
                  <span>{busy ? "Signing in…" : "Continue with Google"}</span>
                </Button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "14px 0" }}>
                <div style={{ flex: 1, height: 1, background: "var(--border, #ddd)" }} />
                <span className="setup-hint" style={{ margin: 0 }}>
                  or
                </span>
                <div style={{ flex: 1, height: 1, background: "var(--border, #ddd)" }} />
              </div>
              <div className="setup-identity-field">
                <label className="setup-section-label">Full name</label>
                <input
                  className="setup-input"
                  type="text"
                  aria-label="Full name"
                  placeholder="Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
                />
              </div>
              <div className="setup-identity-field" style={{ marginTop: "10px" }}>
                <label className="setup-section-label">Email</label>
                <input
                  className="setup-input"
                  type="email"
                  aria-label="Email address"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
                />
                <div style={{ marginTop: "6px" }}>
                  <Button variant="primary" onClick={handleSendCode} disabled={busy || !email.trim()}>
                    {busy ? "Sending…" : "Send code"}
                  </Button>
                </div>
              </div>
            </>
          )}

          {step === "CODE" && (
            <>
              <p className="setup-hint">Enter the 4-digit code we sent to {email}.</p>
              <div className="setup-identity-field" style={{ marginTop: "12px" }}>
                <label className="setup-section-label">Code</label>
                <input
                  className="setup-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  aria-label="4-digit code"
                  placeholder="1234"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  onKeyDown={(e) => e.key === "Enter" && handleVerify()}
                />
                <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                  <Button variant="primary" onClick={handleVerify} disabled={busy || !code.trim()}>
                    {busy ? "Verifying…" : "Verify"}
                  </Button>
                  <Button variant="ghost" onClick={() => setStep("EMAIL")} disabled={busy}>
                    Use a different email
                  </Button>
                </div>
              </div>
            </>
          )}

          {step === "LOGGED_IN" && (
            <>
              <p style={{ margin: 0, color: "var(--text)", fontSize: "0.85rem" }}>
                Logged in as <strong>{loggedInEmail}</strong>.
              </p>
              <div className="setup-identity-field" style={{ marginTop: "12px" }}>
                <label className="setup-section-label">Plan</label>
                {entitlement ? (
                  <>
                    <p style={{ margin: 0, color: "var(--text)", fontSize: "0.85rem" }}>
                      {PLAN_LABELS[entitlement.planId] ?? entitlement.planId} —{" "}
                      <strong>{formatMinutes(entitlement.remainingMinutes)} remaining</strong>
                    </p>
                    {entitlement.interviewPassCount > 0 && (
                      <p style={{ margin: 0, color: "var(--text)", fontSize: "0.85rem" }}>
                        {entitlement.interviewPassCount} Interview Pass{entitlement.interviewPassCount === 1 ? "" : "es"} purchased
                      </p>
                    )}
                  </>
                ) : (
                  <p className="setup-hint" style={{ margin: 0 }}>
                    Loading…
                  </p>
                )}
              </div>
              <div style={{ marginTop: "12px" }}>
                <Button variant="ghost" onClick={handleLogout} disabled={busy}>
                  {busy ? "Logging out…" : "Log out"}
                </Button>
              </div>
            </>
          )}

          {error && (
            <p className="error" style={{ marginTop: "12px" }}>
              {error}
            </p>
          )}

          <div className="popover-footer" style={{ justifyContent: "space-between" }}>
            {appVersion && (
              <span style={{ color: "var(--text-faint)", fontSize: "0.72rem" }}>Smallbird v{appVersion}</span>
            )}
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
