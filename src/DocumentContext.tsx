import { useCallback, useState, type ClipboardEvent, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import type { DocumentType } from "./types";
import { loadLlmProvider } from "./llmProviderSetting";
import { IconAttachment, IconImage } from "./Icons";
import { Button } from "./ui";

export interface DocumentContextSection {
  key: string;
  documentType: DocumentType;
  label: string;
  description?: string;
  /// Text box only — no upload/screenshot icons (e.g. Custom instructions).
  textOnly?: boolean;
  placeholder?: string;
}

export type UploadStatus = "idle" | "uploading" | "ready" | "error" | "empty";

/// One file or image attached to a section. Unlike typed text, these upload
/// the moment they're added (images need a vision-model transcription pass
/// that can take a few seconds — doing it up front keeps Start fast), so by
/// the time Start is pressed they're usually already READY.
export interface ContextAttachment {
  id: string;
  kind: "file" | "image";
  name: string;
  /// Small data-URL thumbnail, images only.
  previewUrl: string | null;
  documentId: string | null;
  status: UploadStatus;
  error: string | null;
}

export interface SectionContextState {
  /// Typed or pasted text — uploaded on Start (or "Save context" mid-session).
  text: string;
  /// The text as of its last successful upload, so an unchanged text box
  /// isn't re-uploaded on every Start.
  uploadedText: string;
  textDocumentId: string | null;
  textStatus: UploadStatus;
  textError: string | null;
  attachments: ContextAttachment[];
}

export type DocumentContextState = Record<string, SectionContextState>;

const EMPTY_SECTION_STATE: SectionContextState = {
  text: "",
  uploadedText: "",
  textDocumentId: null,
  textStatus: "idle",
  textError: null,
  attachments: [],
};

export function emptyDocumentContextState(sections: DocumentContextSection[]): DocumentContextState {
  return Object.fromEntries(sections.map((s) => [s.key, { ...EMPTY_SECTION_STATE }]));
}

/// Number of sections with anything in them (text or attachments).
export function countFilledSections(sections: DocumentContextSection[], state: DocumentContextState): number {
  return sections.filter((s) => {
    const v = state[s.key];
    return v && (v.text.trim() || v.attachments.length > 0);
  }).length;
}

interface UploadedMetadata {
  document_id: string;
  status: string;
  error_message: string | null;
}

function toUploadStatus(meta: UploadedMetadata): UploadStatus {
  return meta.status === "READY" ? "ready" : meta.status === "EMPTY" ? "empty" : "error";
}

/// Uploads each section's typed text when it changed since its last upload
/// (attachments already uploaded when they were added), and AWAITS it —
/// callers must not proceed to a point where the AI might be asked a
/// question until this resolves. Never rejects: a failure is recorded on
/// that section's `textStatus`/`textError`.
///
/// Returns one final merged object rather than reporting per-section
/// progress — sections upload concurrently, and re-deriving
/// `{...state, [key]: patch}` from a closed-over `state` on each update
/// would have later sections clobber earlier ones.
export async function uploadDocumentContext(
  sections: DocumentContextSection[],
  state: DocumentContextState,
): Promise<DocumentContextState> {
  const next: DocumentContextState = { ...state };

  await Promise.all(
    sections.map(async (section) => {
      const value = state[section.key];
      if (!value) return;
      const text = value.text.trim();
      if (text === value.uploadedText && value.textStatus !== "error") return;

      // Superseded (or cleared) — drop the old record so it isn't joined
      // into the AI's context alongside the new one.
      if (value.textDocumentId) {
        invoke("delete_document", { documentId: value.textDocumentId }).catch(() => {});
      }
      if (!text) {
        next[section.key] = { ...value, uploadedText: "", textDocumentId: null, textStatus: "idle", textError: null };
        return;
      }

      try {
        const meta = await invoke<UploadedMetadata>("upload_document", {
          filename: `${section.key}.txt`,
          bytes: Array.from(new TextEncoder().encode(text)),
          documentType: section.documentType,
        });
        next[section.key] = {
          ...value,
          uploadedText: text,
          textDocumentId: meta.document_id,
          textStatus: toUploadStatus(meta),
          textError: meta.error_message,
        };
      } catch (e) {
        next[section.key] = { ...value, textDocumentId: null, textStatus: "error", textError: String(e) };
        console.error(`Failed to upload ${section.label}:`, e);
      }
    }),
  );

  return next;
}

/// Folds `uploadDocumentContext`'s result into the *current* state (pass
/// the returned function to a React state setter). Only the text-upload
/// fields are taken from it, so an attachment that finished uploading while
/// the text was in flight isn't overwritten by the older snapshot.
export function mergeTextUploads(
  uploaded: DocumentContextState,
): (cur: DocumentContextState) => DocumentContextState {
  return (cur) =>
    Object.fromEntries(
      Object.entries(cur).map(([key, value]) => {
        const u = uploaded[key];
        if (!u) return [key, value];
        return [
          key,
          { ...value, uploadedText: u.uploadedText, textDocumentId: u.textDocumentId, textStatus: u.textStatus, textError: u.textError },
        ];
      }),
    );
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp"];
const DOCUMENT_EXTENSIONS = ["pdf", "docx", "txt", "md", "markdown"];
/// Longest side, in px, an attached image is scaled down to before it's
/// sent for transcription — plenty to read screenshot text, without
/// shipping a multi-megabyte 4K capture.
const MAX_IMAGE_SIDE = 2000;

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("couldn't read that image"));
    reader.readAsDataURL(blob);
  });
}

/// Loads via a `data:` URL, not `URL.createObjectURL` — the app's CSP
/// (tauri.conf.json's `img-src`) allows `data:` but not `blob:`, so a
/// blob-URL image always failed to load with no further detail.
async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = await readAsDataUrl(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("couldn't read that image — it may be in a format Windows can't open (try PNG or JPG)"));
    img.src = url;
  });
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
};

/// Re-encodes any image (PNG/JPEG/WebP/...) as a size-capped PNG — the
/// provider layer only declares `image/png`, so this keeps the declared type
/// honest — and makes a small thumbnail for the chip.
async function normalizeImage(blob: Blob): Promise<{ pngBase64: string; previewUrl: string }> {
  const img = await loadImage(blob);
  const draw = (maxSide: number) => {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  };
  const pngBase64 = draw(MAX_IMAGE_SIDE).toDataURL("image/png").split(",")[1];
  const previewUrl = draw(96).toDataURL("image/png");
  return { pngBase64, previewUrl };
}

interface Props {
  sections: DocumentContextSection[];
  state: DocumentContextState;
  /// A React state setter — attachments finish uploading asynchronously, so
  /// updates are applied functionally against the latest state rather than
  /// a stale closure.
  onChange: Dispatch<SetStateAction<DocumentContextState>>;
  /** True while a session is live — shown so it's clear edits apply to the current session. */
  isLive?: boolean;
}

const STATUS_LABEL: Record<UploadStatus, string> = {
  idle: "",
  uploading: "Reading…",
  ready: "Added",
  empty: "No readable text",
  error: "Failed",
};

export function DocumentContext({ sections, state, onChange, isLive }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patchSection = useCallback(
    (key: string, patch: (prev: SectionContextState) => SectionContextState) => {
      onChange((cur) => ({ ...cur, [key]: patch(cur[key] ?? { ...EMPTY_SECTION_STATE }) }));
    },
    [onChange],
  );

  const patchAttachment = useCallback(
    (key: string, id: string, patch: Partial<ContextAttachment>) => {
      patchSection(key, (prev) => ({
        ...prev,
        attachments: prev.attachments.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }));
    },
    [patchSection],
  );

  const addImage = useCallback(
    async (section: DocumentContextSection, blob: Blob, name: string) => {
      const id = newId();
      let normalized: { pngBase64: string; previewUrl: string };
      try {
        normalized = await normalizeImage(blob);
      } catch (e) {
        setError(String(e));
        return;
      }
      patchSection(section.key, (prev) => ({
        ...prev,
        attachments: [
          ...prev.attachments,
          { id, kind: "image", name, previewUrl: normalized.previewUrl, documentId: null, status: "uploading", error: null },
        ],
      }));
      try {
        const meta = await invoke<UploadedMetadata>("upload_image_document", {
          filename: name,
          pngBase64: normalized.pngBase64,
          documentType: section.documentType,
          llmProvider: loadLlmProvider(),
        });
        patchAttachment(section.key, id, { documentId: meta.document_id, status: toUploadStatus(meta), error: meta.error_message });
      } catch (e) {
        patchAttachment(section.key, id, { status: "error", error: String(e) });
      }
    },
    [patchSection, patchAttachment],
  );

  const addFile = useCallback(
    async (section: DocumentContextSection, name: string, bytes: Uint8Array) => {
      const id = newId();
      patchSection(section.key, (prev) => ({
        ...prev,
        attachments: [
          ...prev.attachments,
          { id, kind: "file", name, previewUrl: null, documentId: null, status: "uploading", error: null },
        ],
      }));
      try {
        const meta = await invoke<UploadedMetadata>("upload_document", {
          filename: name,
          bytes: Array.from(bytes),
          documentType: section.documentType,
        });
        patchAttachment(section.key, id, { documentId: meta.document_id, status: toUploadStatus(meta), error: meta.error_message });
      } catch (e) {
        patchAttachment(section.key, id, { status: "error", error: String(e) });
      }
    },
    [patchSection, patchAttachment],
  );

  const pickFile = useCallback(
    async (section: DocumentContextSection) => {
      setError(null);
      try {
        const selected = await open({
          multiple: true,
          filters: [
            { name: "Documents and images", extensions: [...DOCUMENT_EXTENSIONS, ...IMAGE_EXTENSIONS] },
          ],
        });
        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];
        for (const path of paths) {
          const bytes = await readFile(path);
          const name = path.split(/[\\/]/).pop() ?? "document";
          const ext = name.split(".").pop()?.toLowerCase() ?? "";
          if (IMAGE_EXTENSIONS.includes(ext)) {
            void addImage(section, new Blob([bytes], { type: IMAGE_MIME[ext] }), name);
          } else {
            void addFile(section, name, bytes);
          }
        }
      } catch (e) {
        setError(String(e));
      }
    },
    [addImage, addFile],
  );

  // Clipboard button: reads an image (e.g. a Win+Shift+S snip) or, failing
  // that, text straight off the clipboard. Some WebView2 setups block
  // navigator.clipboard.read(), so this falls back to telling the user to
  // Ctrl+V into the text box, which always works via the paste event below.
  const pasteFromClipboard = useCallback(
    async (section: DocumentContextSection) => {
      setError(null);
      setHint(null);
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((t) => t.startsWith("image/"));
          if (imageType) {
            void addImage(section, await item.getType(imageType), `Screenshot ${new Date().toLocaleTimeString()}.png`);
            return;
          }
        }
        const text = await navigator.clipboard.readText();
        if (text.trim()) {
          patchSection(section.key, (prev) => ({
            ...prev,
            text: prev.text ? `${prev.text}\n\n${text}` : text,
            textStatus: "idle",
          }));
          return;
        }
        setHint("Clipboard is empty — copy a screenshot or some text first.");
      } catch {
        setHint("Click the text box and press Ctrl+V to paste.");
      }
    },
    [addImage, patchSection],
  );

  // Ctrl+V into a text box: images become attachments; plain text pastes
  // into the box as normal.
  const handlePaste = useCallback(
    (section: DocumentContextSection, e: ClipboardEvent<HTMLTextAreaElement>) => {
      const images = Array.from(e.clipboardData.items)
        .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => f !== null);
      if (images.length === 0) return;
      e.preventDefault();
      for (const image of images) {
        void addImage(section, image, `Screenshot ${new Date().toLocaleTimeString()}.png`);
      }
    },
    [addImage],
  );

  const removeAttachment = useCallback(
    (key: string, attachment: ContextAttachment) => {
      if (attachment.documentId) {
        invoke("delete_document", { documentId: attachment.documentId }).catch(() => {});
      }
      patchSection(key, (prev) => ({ ...prev, attachments: prev.attachments.filter((a) => a.id !== attachment.id) }));
    },
    [patchSection],
  );

  const setText = useCallback(
    (key: string, text: string) => {
      patchSection(key, (prev) => ({ ...prev, text, textStatus: "idle", textError: null }));
    },
    [patchSection],
  );

  const handleSave = useCallback(async () => {
    setError(null);
    setSaving(true);
    try {
      onChange(mergeTextUploads(await uploadDocumentContext(sections, state)));
    } finally {
      setSaving(false);
    }
  }, [sections, state, onChange]);

  const hasContent = countFilledSections(sections, state) > 0;

  return (
    <div className="setup-sections">
      {error && <p className="error">{error}</p>}
      {hint && <p className="setup-hint">{hint}</p>}
      {isLive && (
        <p className="setup-hint">
          Changes here update what the AI can use for the rest of this session. Screenshots and files apply
          straight away; press "Save context" below for typed text.
        </p>
      )}
      {sections.map((section) => {
        const value = state[section.key] ?? EMPTY_SECTION_STATE;
        return (
          <div className="setup-section" key={section.key}>
            <div className="setup-section-head">
              <span className="setup-section-label">{section.label}</span>
              {value.textStatus !== "idle" ? (
                <span className={`setup-section-status setup-section-status-${value.textStatus}`}>
                  {STATUS_LABEL[value.textStatus]}
                </span>
              ) : (
                <span className="setup-section-optional">Optional</span>
              )}
            </div>
            {section.description && <p className="setup-subtitle">{section.description}</p>}
            {value.textStatus === "error" && value.textError && (
              <p className="error setup-section-error">{value.textError}</p>
            )}

            <div className="setup-section-body">
              {/* Upload / paste-screenshot live as small icons inside the
                  box's bottom-right corner, chat-composer style, rather
                  than a row of full buttons under every section. */}
              <div className={`context-input${section.textOnly ? " text-only" : ""}`}>
                <textarea
                  className="setup-textarea"
                  value={value.text}
                  onChange={(e) => setText(section.key, e.target.value)}
                  onPaste={section.textOnly ? undefined : (e) => handlePaste(section, e)}
                  placeholder={
                    section.placeholder ??
                    (section.textOnly ? "Type here" : "Type or paste text, or Ctrl+V a screenshot")
                  }
                />
                {!section.textOnly && (
                  <div className="context-input-icons">
                    <button
                      type="button"
                      className="context-input-icon"
                      onClick={() => pickFile(section)}
                      title="Upload a file or image (PDF, Word, TXT, PNG, JPG…)"
                      aria-label="Upload a file"
                    >
                      <IconAttachment size={15} />
                    </button>
                    <button
                      type="button"
                      className="context-input-icon"
                      onClick={() => pasteFromClipboard(section)}
                      title="Paste a screenshot from the clipboard"
                      aria-label="Paste a screenshot"
                    >
                      <IconImage size={15} />
                    </button>
                  </div>
                )}
              </div>
              {value.attachments.map((a) => (
                <div className="setup-file-chip context-attachment" key={a.id}>
                  {a.previewUrl ? (
                    <img className="context-attachment-thumb" src={a.previewUrl} alt="" />
                  ) : (
                    <span className="context-attachment-icon" aria-hidden="true">
                      📄
                    </span>
                  )}
                  <span className="context-attachment-main">
                    <span className="setup-file-name">{a.name}</span>
                    <span className={`setup-section-status setup-section-status-${a.status}`}>
                      {a.status === "uploading" && a.kind === "image" ? "Reading screenshot…" : STATUS_LABEL[a.status]}
                    </span>
                    {(a.status === "error" || a.status === "empty") && a.error && (
                      <span className="error-text context-attachment-error">{a.error}</span>
                    )}
                  </span>
                  <button className="link-button" onClick={() => removeAttachment(section.key, a)}>
                    Remove
                  </button>
                </div>
              ))}
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
