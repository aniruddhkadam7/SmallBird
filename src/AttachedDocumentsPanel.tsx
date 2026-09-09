import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DocumentMetadata } from "./types";
import { StatusDot } from "./ui";

const DOC_STATUS_TONE: Record<string, "success" | "danger" | "neutral"> = {
  READY: "success",
  EMPTY: "danger",
  ERROR: "danger",
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/// Lists documents extracted in-process (see src-tauri/src/documents.rs) —
/// no external service to be unavailable, so this only ever shows either
/// what's actually been uploaded or an empty state. Settings'
/// Context/Documents section used to be a static paragraph pointing back at
/// the header's Context (📎) picker with no way to see what had actually
/// been attached. Uploads there happen as soon as Start is pressed (and can
/// also be pushed mid-interview via "Save context"), so polling here picks
/// up new/updated documents shortly after rather than needing a manual
/// refresh.
export function AttachedDocumentsPanel() {
  const [documents, setDocuments] = useState<DocumentMetadata[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const docs = await invoke<DocumentMetadata[]>("list_documents");
      setDocuments(docs);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const removeDocument = useCallback(
    async (documentId: string) => {
      setError(null);
      try {
        await invoke("delete_document", { documentId });
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  return (
    <div className="attached-documents-panel">
      <p className="setup-hint">
        Your resume/CV and job description, attached to Interview sessions. Use the Context (📎) button in the
        header to add or replace them.
      </p>

      {error && <p className="error">{error}</p>}

      {documents === null ? null : documents.length === 0 ? (
        <p className="setup-hint">No documents uploaded yet.</p>
      ) : (
        <ul className="document-list">
          {documents.map((doc) => (
            <li key={doc.document_id} className="document-list-item">
              <div className="document-list-item-main">
                <StatusDot tone={DOC_STATUS_TONE[doc.status] ?? "neutral"} />
                <span className="document-filename">{doc.filename}</span>
                <span className="document-type-tag">{doc.document_type}</span>
              </div>
              <div className="document-list-item-meta">
                {(doc.status === "ERROR" || doc.status === "EMPTY") && (
                  <span className="error-text">{doc.error_message}</span>
                )}
                <span>{formatBytes(doc.file_size)}</span>
                <button className="link-button" onClick={() => removeDocument(doc.document_id)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}
