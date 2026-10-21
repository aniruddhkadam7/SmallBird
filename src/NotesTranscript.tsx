import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  groupLines,
  notesAsText,
  speakerColorClass,
  speakerName,
  type NoteLine,
} from "./notesMode";

interface Props {
  lines: NoteLine[];
  /// Live, not-yet-final speech, keyed by segment id.
  partials: Record<string, { speaker: string; text: string }>;
  names: Record<string, string>;
  onRename: (speaker: string, name: string) => void;
  /// Shown before anyone has said anything.
  emptyText: string;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/// Notes Mode's main panel: the meeting so far, one paragraph per turn of
/// speech, each headed by who said it. Click a name to rename that speaker
/// everywhere (Speaker 1 → Priya).
export function NotesTranscript({ lines, partials, names, onRename, emptyText }: Props) {
  const blocks = useMemo(() => groupLines(lines), [lines]);
  const live = Object.entries(partials).filter(([, p]) => p.text.trim());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Follow new speech only while the reader is already at the bottom — not
  // while they've scrolled up to reread something.
  const pinnedRef = useRef(true);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [blocks, partials]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const startRename = (speaker: string) => {
    setEditing(speaker);
    setDraft(speakerName(speaker, names));
  };
  const commitRename = () => {
    if (editing) onRename(editing, draft.trim());
    setEditing(null);
  };

  const label = (speaker: string, key: string) =>
    editing === speaker ? (
      <input
        key={key}
        className="notes-speaker-input"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") setEditing(null);
        }}
        aria-label="Speaker name"
      />
    ) : (
      <button
        key={key}
        type="button"
        className={`notes-speaker ${speakerColorClass(speaker)}`}
        onClick={() => startRename(speaker)}
        data-tooltip="Rename this speaker"
      >
        {speakerName(speaker, names)}
      </button>
    );

  return (
    <div className="overlay-panel notes-panel">
      <div className="overlay-header overlay-panel-toolbar" data-tauri-drag-region="deep">
        <span className="notes-title">Who said what</span>
        <div className="overlay-action-bar-spacer" />
        <button
          type="button"
          className="overlay-pill-button"
          onClick={() =>
            navigator.clipboard
              .writeText(notesAsText(lines, names))
              .then(() => setCopied(true))
              .catch(() => {})
          }
          disabled={lines.length === 0}
          data-tooltip="Copy the whole transcript"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div
        className="overlay-chat notes-transcript"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {blocks.length === 0 && live.length === 0 ? (
          <p className="overlay-empty">{emptyText}</p>
        ) : (
          <>
            {blocks.map((b) => (
              <div key={b.id} className="notes-block">
                <div className="notes-block-head">
                  {label(b.speaker, "label")}
                  <span className="notes-time">{formatTime(b.at)}</span>
                </div>
                <p className="notes-text">{b.text}</p>
              </div>
            ))}
            {live.map(([id, p]) => (
              <div key={id} className="notes-block live">
                <div className="notes-block-head">{label(p.speaker, "label")}</div>
                <p className="notes-text">{p.text}</p>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
