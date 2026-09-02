import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_OVERLAY_SETTINGS,
  SIZE_FRACTIONS,
  type AnswerLength,
  type OverlayDensity,
  type OverlaySettings,
  type OverlaySize,
  type ResponseStyle,
} from "./overlaySettings";
import { Select } from "./ui";

interface Props {
  settings: OverlaySettings;
  onChange: (settings: OverlaySettings) => void;
  onClose: () => void;
  captureExcluded: boolean | null;
}

/// Interview Mode's Settings panel — everything the overlay needs beyond the
/// question/answer flow, without becoming the large Record/Prepare
/// dashboard. Renders inline in the same small overlay window (swapped in for
/// the question/answer body), not a separate window.
export function OverlaySettingsPanel({ settings, onChange, onClose, captureExcluded }: Props) {
  const set = <K extends keyof OverlaySettings>(key: K, value: OverlaySettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  const changeSize = (size: OverlaySize) => {
    set("size", size);
    invoke("resize_interview_overlay", { fraction: SIZE_FRACTIONS[size] }).catch(() => {
      // Best-effort — the CSS size-* class still applies even if the actual
      // OS window resize fails, so the panel remains usable either way.
    });
  };

  const resetDefaults = () => onChange({ ...DEFAULT_OVERLAY_SETTINGS });

  return (
    <div className="overlay-body overlay-settings">
      <div className="overlay-settings-section">
        <span className="overlay-settings-label">Appearance</span>

        <div className="overlay-settings-row">
          <span>Overlay size</span>
          <Select
            className="select-overlay"
            value={settings.size}
            onChange={changeSize}
            aria-label="Overlay size"
            options={[
              { value: "small", label: "Small" },
              { value: "medium", label: "Medium" },
              { value: "large", label: "Large" },
            ]}
          />
        </div>

        <label className="overlay-settings-row">
          <span>Font size</span>
          <input
            type="range"
            min={12}
            max={20}
            step={1}
            value={settings.fontSize}
            onChange={(e) => set("fontSize", Number(e.target.value))}
          />
          <span className="overlay-settings-value">{settings.fontSize}px</span>
        </label>

        <div className="overlay-settings-row">
          <span>Text density</span>
          <Select
            className="select-overlay"
            value={settings.density}
            onChange={(v: OverlayDensity) => set("density", v)}
            aria-label="Text density"
            options={[
              { value: "compact", label: "Compact" },
              { value: "comfortable", label: "Comfortable" },
            ]}
          />
        </div>
      </div>

      <div className="overlay-settings-section">
        <span className="overlay-settings-label">Answer</span>

        <div className="overlay-settings-row">
          <span>Answer length</span>
          <Select
            className="select-overlay"
            value={settings.answerLength}
            onChange={(v: AnswerLength) => set("answerLength", v)}
            aria-label="Answer length"
            options={[
              { value: "brief", label: "Brief (1-3 sentences)" },
              { value: "default", label: "Default (~50-120 words)" },
              { value: "detailed", label: "Detailed" },
            ]}
          />
        </div>

        <div className="overlay-settings-row">
          <span>Response style</span>
          <Select
            className="select-overlay"
            value={settings.responseStyle}
            onChange={(v: ResponseStyle) => set("responseStyle", v)}
            aria-label="Response style"
            options={[
              { value: "natural", label: "Natural" },
              { value: "technical", label: "Technical" },
              { value: "concise", label: "Concise" },
            ]}
          />
        </div>
      </div>

      <div className="overlay-settings-section">
        <span className="overlay-settings-label">Screen Capture Protection</span>
        <p>{captureExcluded ? "● Enabled" : "⚠ Unavailable"}</p>
      </div>

      <div className="overlay-settings-section">
        <span className="overlay-settings-label">Hotkeys</span>
        <p>ENTER — Ask AI</p>
        <p>SHIFT+ENTER — new line while editing</p>
        <p>ESC — hide overlay</p>
      </div>

      <div className="overlay-settings-actions">
        <button className="overlay-button" onClick={resetDefaults}>
          Reset to defaults
        </button>
        <button className="overlay-button primary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
