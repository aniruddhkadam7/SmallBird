"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Factor {
  id: string;
  factor_type: string;
  status: string;
}

export function MfaEnrollment() {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const supabase = createClient();
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (!listError) setFactors(data.totp);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function startEnroll() {
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setLoading(false);
    if (enrollError) {
      setError(enrollError.message);
      return;
    }
    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setEnrolling(true);
  }

  async function confirmEnroll() {
    if (!factorId) return;
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) {
      setLoading(false);
      setError(challengeError.message);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    });
    setLoading(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    setEnrolling(false);
    setQrCode(null);
    setCode("");
    await refresh();
  }

  async function unenroll(id: string) {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.mfa.unenroll({ factorId: id });
    setLoading(false);
    await refresh();
  }

  const verified = factors?.filter((f) => f.status === "verified") ?? [];

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-ink">Two-factor authentication</h2>
      <p className="mt-1 text-xs text-muted">
        Optional, backed by Supabase Auth&apos;s built-in TOTP support -- no extra infrastructure needed.
      </p>

      {verified.length > 0 && (
        <div className="mt-3 space-y-2">
          {verified.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded-lg border border-border p-2 text-sm">
              <span>Authenticator app enrolled</span>
              <button onClick={() => unenroll(f.id)} disabled={loading} className="btn-secondary">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {verified.length === 0 && !enrolling && (
        <button onClick={startEnroll} disabled={loading} className="btn-primary mt-3">
          Enroll authenticator app
        </button>
      )}

      {enrolling && qrCode && (
        <div className="mt-3 space-y-3">
          <img src={qrCode} alt="TOTP QR code" className="h-40 w-40 rounded border border-border" />
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Enter the 6-digit code</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} className="input" maxLength={6} />
          </div>
          <div className="flex gap-2">
            <button onClick={confirmEnroll} disabled={loading || code.length !== 6} className="btn-primary flex-1">
              Confirm
            </button>
            <button
              onClick={() => {
                setEnrolling(false);
                setQrCode(null);
              }}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
