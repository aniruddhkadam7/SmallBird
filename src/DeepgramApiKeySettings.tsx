import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui";
import { clearDeepgramApiKey, getDeepgramApiKey, setDeepgramApiKey } from "./deepgramApiKey";

/// Deepgram is STT, not an LLM provider, so this is a small sibling to
/// `PersonalApiKeySettings.tsx` (single fixed entry instead of a list) rather
/// than folded into it. Same secure storage mechanism (Windows Credential
/// Manager via the `keyring` crate). Required for Interview Mode/Meeting
/// Mode transcription — recording will fail with a clear error until a key
/// is saved here.
export function DeepgramApiKeySettings() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    getDeepgramApiKey()
      .then((value) => {
        setKey(value ?? "");
        setSaved(!!value);
      })
      .catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      await setDeepgramApiKey(key);
      setSaved(true);
      setStatus("Deepgram key saved.");
    } catch (err) {
      setStatus(`Failed to save Deepgram key: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [key]);

  const handleClear = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      await clearDeepgramApiKey();
      setKey("");
      setSaved(false);
      setStatus("Deepgram key cleared.");
    } catch (err) {
      setStatus(`Failed to clear Deepgram key: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div>
      <p className="setup-hint">
        Speech-to-text (Interview Mode, Meeting Mode) uses Deepgram — audio is sent, encrypted, directly to
        Deepgram using this key, and nowhere else. Get a free-tier key at console.deepgram.com. Stored
        securely in Windows Credential Manager on this device only.
      </p>

      <div className="setup-identity-field" style={{ marginTop: "12px" }}>
        <label className="setup-section-label">Deepgram</label>
        <input
          className="setup-input"
          type="password"
          aria-label="Deepgram API key"
          placeholder={saved ? "Key saved — enter a new key to replace it" : "Deepgram API key"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
          <Button variant="primary" onClick={handleSave} disabled={busy || !key}>
            {busy ? "Working…" : "Save"}
          </Button>
          <Button variant="ghost" onClick={handleClear} disabled={busy || !saved}>
            Clear
          </Button>
        </div>
      </div>

      {status && <p className="setup-hint">{status}</p>}
    </div>
  );
}
