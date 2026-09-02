import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui";
import {
  getAuthSession,
  getEntitlement,
  logout,
  requestLoginOtp,
  verifyLoginOtp,
  type AuthSessionInfo,
  type EntitlementInfo,
} from "./auth";

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
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loggedInEmail, setLoggedInEmail] = useState<string | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementInfo | null>(null);

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
      const session = await verifyLoginOtp(email.trim(), trimmed);
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
              <div className="setup-identity-field" style={{ marginTop: "12px" }}>
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
              <p className="setup-hint">Enter the 6-digit code we sent to {email}.</p>
              <div className="setup-identity-field" style={{ marginTop: "12px" }}>
                <label className="setup-section-label">Code</label>
                <input
                  className="setup-input"
                  type="text"
                  inputMode="numeric"
                  aria-label="6-digit code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
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
              <p className="setup-hint">Logged in as {loggedInEmail}.</p>
              <div className="setup-identity-field" style={{ marginTop: "12px" }}>
                <label className="setup-section-label">Plan</label>
                {entitlement ? (
                  <p className="setup-hint" style={{ margin: 0 }}>
                    {PLAN_LABELS[entitlement.planId] ?? entitlement.planId} —{" "}
                    <strong>{formatMinutes(entitlement.remainingMinutes)} remaining</strong>
                  </p>
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

          <div className="popover-footer">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
