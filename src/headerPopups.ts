import type { DocumentContextSection } from "./DocumentContext";

export const INTERVIEW_CONTEXT_SECTIONS: DocumentContextSection[] = [
  { key: "resume", documentType: "RESUME", label: "Resume / CV" },
  { key: "job_description", documentType: "JOB_DESCRIPTION", label: "Job Description" },
  {
    key: "additional_context",
    documentType: "ADDITIONAL_CONTEXT",
    label: "Additional Context",
    description: "Anything else worth the AI knowing — company details, specific instructions, etc.",
  },
];
