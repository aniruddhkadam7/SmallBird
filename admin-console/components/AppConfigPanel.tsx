"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { callAdminFunction, AdminApiError } from "@/lib/adminApi";

interface ApiKeyRow {
  keyName: string;
  label: string;
  description: string;
  isSet: boolean;
  keyHint: string | null;
  updatedAt: string | null;
  updatedByEmail: string | null;
}

interface Props {
  apiKeys: ApiKeyRow[];
  onSuccess: () => void;
}

async function getToken() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Session expired — please sign in again.");
  return session.access_token;
}

function ApiKeyRow({ row, onSuccess }: { row: ApiKeyRow; onSuccess: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveKey() {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      await callAdminFunction(token, "admin-set-app-setting", {
        type: "api_key",
        keyName: row.keyName,
        value: value.trim(),
      });
      setValue("");
      setEditing(false);
      setConfirming(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Failed to save key");
    } finally {
      setLoading(false);
    }
  }

  async function clearKey() {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      await callAdminFunction(token, "admin-set-app-setting", {
        type: "clear_api_key",
        keyName: row.keyName,
      });
      setConfirmClear(false);
      onSuccess();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Failed to clear key");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{row.label}</p>
          <p className="text-xs text-muted">{row.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {row.isSet ? (
            <>
              <span className="font-mono text-xs text-muted">{row.keyHint}</span>
              <span className="badge badge-ok">DB override</span>
            </>
          ) : (
            <span className="badge badge-muted">env secret</span>
          )}
        </div>
      </div>

      {row.updatedByEmail && (
        <p className="text-xs text-muted">
          Updated by {row.updatedByEmail}
          {row.updatedAt && <> on {new Date(row.updatedAt).toLocaleString()}</>}
        </p>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      {!editing ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setEditing(true); setConfirmClear(false); }}
            className="btn-secondary text-xs"
          >
            {row.isSet ? "Rotate key" : "Set DB override"}
          </button>
          {row.isSet && !confirmClear && (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="btn-secondary text-xs text-danger"
            >
              Clear override
            </button>
          )}
          {confirmClear && (
            <div className="flex gap-2">
              <button type="button" disabled={loading} onClick={clearKey} className="btn-secondary text-xs text-danger">
                {loading ? "Clearing…" : "Confirm clear"}
              </button>
              <button type="button" onClick={() => setConfirmClear(false)} className="btn-secondary text-xs">
                Cancel
              </button>
            </div>
          )}
        </div>
      ) : !confirming ? (
        <div className="space-y-2">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="input font-mono text-sm"
            placeholder={`Paste new ${row.label}`}
            autoComplete="off"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={value.trim().length === 0}
              onClick={() => setConfirming(true)}
              className="btn-primary text-xs"
            >
              Continue
            </button>
            <button type="button" onClick={() => { setEditing(false); setValue(""); setError(null); }} className="btn-secondary text-xs">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-subtle p-3 space-y-2">
          <p className="text-sm text-ink">
            Save new key for <strong>{row.label}</strong>?
          </p>
          <p className="text-xs text-muted">
            Ends in <span className="font-mono">{value.slice(-6)}</span>. This overrides the env secret and is audited.
          </p>
          <div className="flex gap-2">
            <button type="button" disabled={loading} onClick={saveKey} className="btn-primary flex-1 text-xs">
              {loading ? "Saving…" : "Confirm"}
            </button>
            <button type="button" disabled={loading} onClick={() => setConfirming(false)} className="btn-secondary flex-1 text-xs">
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AppConfigPanel({ apiKeys, onSuccess }: Props) {
  return (
    <section className="card">
      <h2 className="text-sm font-semibold text-ink">API key management</h2>
      <p className="mt-1 text-xs text-muted">
        DB overrides take precedence over Supabase env secrets. Use these to rotate keys without
        redeploying edge functions. Leave unset to fall back to the deployed env secret.
      </p>
      <div className="mt-4 space-y-3">
        {apiKeys.map((k) => (
          <ApiKeyRow key={k.keyName} row={k} onSuccess={onSuccess} />
        ))}
      </div>
    </section>
  );
}
