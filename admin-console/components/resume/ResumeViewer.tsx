"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { ResumePreview } from "@/components/resume/resume-preview";
import { normalizeResume } from "@/lib/resume/types";
import { resumeFonts } from "@/lib/resume/fonts";
import "@/components/resume/resume.css";

// A resume shown the way the user sees it in the builder: their template on
// a white A4 sheet, scaled down to fit the screen. Works for saved resumes,
// snapshots and the AI's output alike (normalizeResume fills any gaps).
export function ResumeViewer({ title, subtitle, data, onClose }: { title: string; subtitle?: string; data: unknown; onClose: () => void }) {
  const resume = useMemo(() => normalizeResume(data), [data]);
  const frame = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  // The sheet is a fixed 210mm wide; shrink it to the frame's width (never enlarge).
  useLayoutEffect(() => {
    const fit = () => {
      if (!frame.current || !sheet.current) return;
      const s = Math.min(1, frame.current.clientWidth / sheet.current.offsetWidth);
      setScale(s);
      setHeight(sheet.current.offsetHeight * s);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (frame.current) ro.observe(frame.current);
    if (sheet.current) ro.observe(sheet.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div data-resume-viewer className="fixed inset-0 z-50 flex flex-col bg-black/70" onClick={onClose}>
      <div
        className="safe-x flex items-center justify-between gap-3 border-b border-border bg-surface pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </div>
        <button onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-subtle hover:text-ink" aria-label="Close">
          <X size={20} />
        </button>
      </div>
      {/* overflow-x-hidden: the sheet is laid out 210mm wide before it's
          scaled down, which would otherwise let a phone scroll sideways. */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 sm:px-4 sm:pt-6">
        <div ref={frame} className="mx-auto w-full max-w-[210mm]" style={{ height }} onClick={(e) => e.stopPropagation()}>
          <div
            ref={sheet}
            className={`${resumeFonts} w-[210mm] origin-top-left shadow-2xl`}
            style={{ transform: `scale(${scale})` }}
          >
            <ResumePreview data={resume} />
          </div>
        </div>
      </div>
    </div>
  );
}
