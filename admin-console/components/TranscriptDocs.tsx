"use client";

export interface ContextDoc {
  id: string;
  docType: string;
  filename: string;
  text: string;
}

const SECTION_LABELS: Record<string, string> = {
  INTERVIEW_INSTRUCTIONS: "Custom instructions",
  RESUME: "Resume / CV",
  JOB_DESCRIPTION: "Job description",
  ADDITIONAL_CONTEXT: "Additional context",
  MEETING_INSTRUCTIONS: "Custom instructions",
  MEETING_AGENDA: "Meeting agenda",
  MEETING_DOCUMENTS: "Documents / presentations",
  KNOWLEDGE_BASE: "Company knowledge base",
  PREVIOUS_MEETING_NOTES: "Previous meeting notes",
  ASSISTANT_INSTRUCTIONS: "Custom instructions",
  ASSISTANT_CONTEXT: "Files & notes",
};

function sectionLabel(docType: string): string {
  if (docType.startsWith("CUSTOM_INSTRUCTIONS:")) return "Custom instructions";
  if (docType.startsWith("CUSTOM_CONTEXT:")) return "Documents & notes";
  return SECTION_LABELS[docType] ?? docType;
}

/// Typed text is uploaded as "<section key>.txt" (see the desktop app's
/// DocumentContext.tsx), so that name means "typed or pasted", not a file.
function sourceLabel(filename: string): string {
  if (/^[a-z_]+\.txt$/.test(filename)) return "Typed / pasted";
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(filename)) return `${filename} (text read from image)`;
  return filename;
}

// Everything the user gave the AI as context in a session, shown above its
// transcript. Collapsed by default — it can be long, and usually the turns
// are what's being read.
export function TranscriptDocs({ docs }: { docs: ContextDoc[] | null | undefined }) {
  if (!docs || docs.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Context added ({docs.length})</p>
      {docs.map((doc) => (
        <details key={doc.id} className="card group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="text-sm font-medium text-ink">{sectionLabel(doc.docType)}</span>
              <span className="ml-2 break-all text-xs text-muted">{sourceLabel(doc.filename)}</span>
            </span>
            <span className="flex-shrink-0 text-xs text-accent group-open:hidden">Show</span>
            <span className="hidden flex-shrink-0 text-xs text-accent group-open:inline">Hide</span>
          </summary>
          <p className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap text-sm text-ink">{doc.text}</p>
        </details>
      ))}
    </div>
  );
}
