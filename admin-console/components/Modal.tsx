"use client";

// Small reusable overlay/dialog shell, extracted from TranscriptModal's
// markup so any panel (e.g. ManageMinutesPanel) can be shown on demand
// instead of permanently occupying page space.
import { useEffect } from "react";
import { X } from "lucide-react";

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-surface shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between gap-4 border-b border-border bg-surface p-4">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="flex-shrink-0 rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
