"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { callAdminFunction, AdminApiError } from "@/lib/adminApi";

type Action = "GRANT" | "REMOVE" | "SET";

export function ManageMinutesPanel({
  userId,
  currentBalance,
  onSuccess,
}: {
  userId: string;
  currentBalance: number;
  onSuccess: () => void;
}) {
  const [action, setAction] = useState<Action>("GRANT");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const amountNum = Number(amount);
  const canSubmit = amount.trim() !== "" && Number.isFinite(amountNum) && amountNum >= 0 && reason.trim().length > 0;

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Session expired -- please sign in again.");

      await callAdminFunction(session.access_token, "admin-adjust-entitlement", {
        targetUserId: userId,
        action,
        amount: amountNum,
        reason: reason.trim(),
      });

      setAmount("");
      setReason("");
      setConfirming(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Failed to apply change");
    } finally {
      setLoading(false);
    }
  }

  const preview =
    action === "GRANT"
      ? `${currentBalance.toFixed(1)} + ${amountNum || 0} = ${(currentBalance + (amountNum || 0)).toFixed(1)}`
      : action === "REMOVE"
        ? `${currentBalance.toFixed(1)} - ${amountNum || 0} = ${Math.max(currentBalance - (amountNum || 0), 0).toFixed(1)}`
        : `${currentBalance.toFixed(1)} -> ${amountNum || 0}`;

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-ink">Manage minutes</h2>
      <p className="mt-1 text-xs text-muted">Current balance: {currentBalance.toFixed(1)} min</p>

      <div className="mt-4 space-y-3">
        <div className="flex gap-2">
          {(["GRANT", "REMOVE", "SET"] as Action[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => {
                setAction(a);
                setConfirming(false);
              }}
              className={action === a ? "btn-primary" : "btn-secondary"}
            >
              {a === "GRANT" ? "Grant" : a === "REMOVE" ? "Remove" : "Set balance"}
            </button>
          ))}
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">
            {action === "SET" ? "New balance (minutes)" : "Amount (minutes)"}
          </label>
          <input
            type="number"
            min={0}
            step="0.1"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setConfirming(false);
            }}
            className="input"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">Reason (required, audited)</label>
          <textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setConfirming(false);
            }}
            className="input"
            rows={2}
            placeholder="e.g. Customer support -- refunded a failed session"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        {!confirming ? (
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => setConfirming(true)}
            className="btn-primary w-full"
          >
            Continue
          </button>
        ) : (
          <div className="rounded-lg border border-border bg-subtle p-3">
            <p className="text-sm text-ink">
              {action === "GRANT" ? "Grant" : action === "REMOVE" ? "Remove" : "Set balance to"} {amountNum} minutes?
            </p>
            <p className="mt-1 font-mono text-xs text-muted">{preview}</p>
            <p className="mt-1 text-xs text-muted">This is written to the audit log and entitlement ledger.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={loading} onClick={submit} className="btn-primary flex-1">
                {loading ? "Applying..." : "Confirm"}
              </button>
              <button type="button" disabled={loading} onClick={() => setConfirming(false)} className="btn-secondary flex-1">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
