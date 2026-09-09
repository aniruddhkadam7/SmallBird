import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import type { DocumentType } from "./types";
import { Button } from "./ui";

export interface DocumentContextSection {
  key: string;
  documentType: DocumentType;
  label: string;
  description?: string;
}

export type UploadStatus = "idle" | "uploading" | "ready" | "error" | "empty";

export type DocumentContextState = Record<
  string,
  {
    fileName: string | null;
    fileBytes: number[] | null;
    text: string;
    documentId: string | null;
    status: UploadStatus;
    error: string | null;
  }
>;

const EMPTY_SECTION_STATE = {
  fileName: null,
  fileBytes: null,
  text: "",
  documentId: null,
  status: "idle" as UploadStatus,
  error: null,
};

export function emptyDocumentContextState(sections: DocumentContextSection[]): DocumentContextState {
  return Object.fromEntries(sections.map((s) => [s.key, { ...EMPTY_SECTION_STATE }]));
}

interface UploadedMetadata {
  document_id: string;
  status: string;
  error_message: string | null;
}

/// Uploads (or re-uploads) every section that has a file or pasted text, and
/// AWAITS extraction finishing — callers must not proceed to a point where
/// the AI might be asked a question until this resolves, otherwise
/// `ask_interview_question` can run before the document is READY and
/// silently answer without it. Never rejects: a failed upload for one
/// section is recorded in that section's `status`/`error` (via `onStatus`)
/// rather than blocking the others or the caller.
///
/// Returns the updated state so callers can persist `documentId`/`status`
/// back into their state (needed so "Remove" can delete the right backend
/// record, and so the UI can show whether the AI actually has each
/// document). Intentionally returns one final merged object rather than
/// reporting per-section progress via a callback — sections upload
/// concurrently, and a caller re-deriving `{...state, [key]: patch}` from a
/// closed-over `state` on each intermediate update would have later
/// sections' progress clobber earlier ones' in React state.
export async function uploadDocumentContext(
  sections: DocumentContextSection[],
  state: DocumentContextState,
): Promise<DocumentContextState> {
  const next: DocumentContextState = { ...state };

  await Promise.all(
    sections.map(async (section) => {
      const value = state[section.key];
      if (!value) return;

      let filename: string;
      let bytes: number[];
      if (value.fileBytes && value.fileName) {
        filename = value.fileName;
        bytes = value.fileBytes;
      } else if (value.text.trim()) {
        filename = `${section.key}.txt`;
        bytes = Array.from(new TextEncoder().encode(value.text.trim()));
      } else {
        return; // nothing attached for this section
      }

      try {
        const meta = await invoke<UploadedMetadata>("upload_document", {
          filename,
          bytes,
          documentType: section.documentType,
        });
        // A previous version of this section's document is now superseded —
        // delete it so a stale record can't be picked up by
        // `latest_ready_text` if this upload's timestamp ever ties/loses.
        if (value.documentId && value.documentId !== meta.document_id) {
          invoke("delete_document", { documentId: value.documentId }).catch(() => {});
        }
        next[section.key] = {
          ...next[section.key],
          documentId: meta.document_id,
          status: meta.status === "READY" ? "ready" : meta.status === "EMPTY" ? "empty" : "error",
          error: meta.error_message,
        };
      } catch (e) {
        next[section.key] = { ...next[section.key], status: "error", error: String(e) };
        console.error(`Failed to upload ${section.label}:`, e);
      }
    }),
  );

  return next;
}

interface Props {
  sections: DocumentContextSection[];
  state: DocumentContextState;
  onChange: (state: DocumentContextState) => void;
  /** True while a session is live — shown so it's clear edits apply to the current interview. */
  isLive?: boolean;
}

const STATUS_LABEL: Record<UploadStatus, string> = {
  idle: "",
  uploading: "Uploading…",
  ready: "Attached",
  empty: "No readable text found",
  error: "Failed to attach",
};

export function DocumentContext({ sections, state, onChange, isLive }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pickFile = useCallback(
    async (key: string) => {
      setError(null);
      try {
        const selected = await open({
          multiple: false,
          filters: [{ name: "Documents", extensions: ["pdf", "docx", "txt", "md", "markdown"] }],
        });
        if (!selected || Array.isArray(selected)) return;
        const bytes = await readFile(selected);
        const fileName = selected.split(/[\\/]/).pop() ?? "document";
        onChange({
          ...state,
          [key]: { ...EMPTY_SECTION_STATE, fileName, fileBytes: Array.from(bytes) },
        });
      } catch (e) {
        setError(String(e));
      }
    },
    [state, onChange],
  );

  const clearFile = useCallback(
    (key: string) => {
      const documentId = state[key]?.documentId;
      if (documentId) {
        invoke("delete_document", { documentId }).catch(() => {});
      }
      onChange({ ...state, [key]: { ...EMPTY_SECTION_STATE } });
    },
    [state, onChange],
  );

  const setText = useCallback(
    (key: string, text: string) => {
      onChange({ ...state, [key]: { ...state[key], fileName: null, fileBytes: null, text, status: "idle" } });
    },
    [state, onChange],
  );

  const handleSave = useCallback(async () => {
    setError(null);
    setSaving(true);
    try {
      const uploading: DocumentContextState = { ...state };
      for (const section of sections) {
        const value = state[section.key];
        if (value && ((value.fileBytes && value.fileName) || value.text.trim())) {
          uploading[section.key] = { ...value, status: "uploading", error: null };
        }
      }
      onChange(uploading);
      const next = await uploadDocumentContext(sections, state);
      onChange(next);
    } finally {
      setSaving(false);
    }
  }, [sections, state, onChange]);

  const hasContent = sections.some((s) => {
    const v = state[s.key];
    return v && ((v.fileBytes && v.fileName) || v.text.trim());
  });

  return (
    <div className="setup-sections">
      {error && <p className="error">{error}</p>}
      {isLive && (
        <p className="setup-hint">
          Attaching or changing a document here updates what the AI can use for the rest of this interview — press
          "Save context" below once you're done.
        </p>
      )}
      {sections.map((section) => {
        const value = state[section.key] ?? EMPTY_SECTION_STATE;
        return (
          <div className="setup-section" key={section.key}>
            <div className="setup-section-head">
              <span className="setup-section-label">{section.label}</span>
              {value.status !== "idle" ? (
                <span className={`setup-section-status setup-section-status-${value.status}`}>
                  {STATUS_LABEL[value.status]}
                </span>
              ) : (
                <span className="setup-section-optional">Optional</span>
              )}
            </div>
            {section.description && <p className="setup-subtitle">{section.description}</p>}
            {value.status === "error" && value.error && <p className="error setup-section-error">{value.error}</p>}
            {value.status === "empty" && (
              <p className="setup-hint setup-section-error">
                We couldn't find readable text in this file (it may be a scanned/image-only PDF) — try pasting the
                text directly instead.
              </p>
            )}

            <div className="setup-section-body">
              {value.fileName ? (
                <div className="setup-file-chip">
                  <span className="setup-file-name">{value.fileName}</span>
                  <button className="link-button" onClick={() => clearFile(section.key)}>
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={() => pickFile(section.key)}>
                    Upload a file
                  </Button>
                  <textarea
                    className="setup-textarea"
                    value={value.text}
                    onChange={(e) => setText(section.key, e.target.value)}
                    placeholder="Or paste text here"
                  />
                </>
              )}
            </div>
          </div>
        );
      })}
      {isLive && (
        <div className="setup-section-actions">
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !hasContent}>
            {saving ? "Saving…" : "Save context"}
          </Button>
        </div>
      )}
    </div>
  );
}
