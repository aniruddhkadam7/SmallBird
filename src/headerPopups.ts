import type { DocumentContextSection } from "./DocumentContext";

export const INTERVIEW_CONTEXT_SECTIONS: DocumentContextSection[] = [
  { key: "resume", documentType: "RESUME", label: "Resume / CV" },
  { key: "job_description", documentType: "JOB_DESCRIPTION", label: "Job Description" },
];

// Meeting Mode has no CV/JD-equivalent document type — the general
// "Attached Documents" upload (Project/Company/Other) was removed along
// with RAG search, since none of it ever reached the LLM as full text.
export const MEETING_CONTEXT_SECTIONS: DocumentContextSection[] = [];
