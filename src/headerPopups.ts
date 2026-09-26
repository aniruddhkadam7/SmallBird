import type { DocumentContextSection } from "./DocumentContext";

/// Key of the "Custom instructions" section in both lists below — App.tsx
/// remembers its text across launches and leaves it out of the "N added"
/// context count, since it's a standing preference rather than per-session
/// material.
export const INSTRUCTIONS_SECTION_KEY = "instructions";

export const INTERVIEW_CONTEXT_SECTIONS: DocumentContextSection[] = [
  {
    key: INSTRUCTIONS_SECTION_KEY,
    documentType: "INTERVIEW_INSTRUCTIONS",
    label: "Custom instructions",
    textOnly: true,
    placeholder: "How should the AI answer? e.g. Keep answers under 5 lines, mention my AWS experience where it fits",
  },
  { key: "resume", documentType: "RESUME", label: "Resume / CV" },
  { key: "job_description", documentType: "JOB_DESCRIPTION", label: "Job Description" },
  {
    key: "additional_context",
    documentType: "ADDITIONAL_CONTEXT",
    label: "Additional Context",
    description: "Anything else worth the AI knowing — company details, projects, notes, etc.",
  },
];

// Meeting Mode's own document types — deliberately distinct from the
// interview ones above so a resume never leaks into a meeting's answers (or
// a meeting's docs into an interview). Read back by type on the Rust side
// (interview_mode/commands.rs's build_ask_request).
export const MEETING_CONTEXT_SECTIONS: DocumentContextSection[] = [
  {
    key: INSTRUCTIONS_SECTION_KEY,
    documentType: "MEETING_INSTRUCTIONS",
    label: "Custom instructions",
    textOnly: true,
    placeholder: "How should the AI answer? e.g. Be concise, speak as the account manager, never quote prices",
  },
  { key: "agenda", documentType: "MEETING_AGENDA", label: "Meeting agenda" },
  {
    key: "documents",
    documentType: "MEETING_DOCUMENTS",
    label: "Documents / presentations",
    description: "Slides, specs, proposals, reports — anything being discussed.",
  },
  {
    key: "knowledge_base",
    documentType: "KNOWLEDGE_BASE",
    label: "Company knowledge base",
    description: "Product details, pricing, FAQs, policies — what you'd want on hand to answer questions.",
  },
  { key: "previous_notes", documentType: "PREVIOUS_MEETING_NOTES", label: "Previous meeting notes" },
];

// Assistant Mode's own document types — isolated from both lists above, so
// nothing from an interview or meeting reaches the assistant or vice versa.
export const ASSISTANT_CONTEXT_SECTIONS: DocumentContextSection[] = [
  {
    key: INSTRUCTIONS_SECTION_KEY,
    documentType: "ASSISTANT_INSTRUCTIONS",
    label: "Custom instructions",
    textOnly: true,
    placeholder: "How should the assistant answer? e.g. Keep it short, explain like I'm new to this, reply in Hindi",
  },
  {
    key: "files",
    documentType: "ASSISTANT_CONTEXT",
    label: "Files & notes",
    description: "Anything you want help with — documents, screenshots, notes, pasted text.",
  },
];
