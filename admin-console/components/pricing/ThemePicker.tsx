"use client";

import { THEMES, themePreviewUrl, type Theme } from "@/lib/pricing";

// Festive animation for an announcement, with a link that plays it on the
// live site without publishing anything.
export function ThemePicker({ value, onChange }: { value: Theme; onChange: (t: Theme) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">Animation when visitors open the site</p>
      <div className="flex flex-wrap items-center gap-2">
        {THEMES.map((t) => (
          <button key={t.id} type="button" onClick={() => onChange(t.id)} className={value === t.id ? "btn-primary" : "btn-secondary"}>
            {t.label}
          </button>
        ))}
        {value !== "none" && (
          <a href={themePreviewUrl(value)} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent underline">
            Preview on website ↗
          </a>
        )}
      </div>
    </div>
  );
}
