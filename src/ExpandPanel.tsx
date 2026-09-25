import { useEffect, useRef, useState, type ReactNode } from "react";

const COLLAPSE_MS = 220;

/// A panel that grows straight down out of the bottom edge of the compact
/// Smallbird bar — full bar width, attached to it, sized to its content —
/// and slides back up when closed, so Settings/Context read as the bar
/// itself expanding rather than a separate popup floating over it. Purely
/// visual: the OS window is already a fixed 760x720 with a transparent area
/// under the bar (see main_window.rs), so nothing is resized and nothing
/// jitters; this just paints into space the window already has.
///
/// `panelKey` names what's open (null = closed). The last content is kept
/// on screen while collapsing so it slides away instead of vanishing first.
export function ExpandPanel({
  panelKey,
  onClose,
  children,
}: {
  panelKey: string | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const open = panelKey !== null;
  const [rendered, setRendered] = useState(open);
  const [expanded, setExpanded] = useState(false);
  const lastChildren = useRef<ReactNode>(children);
  const panelRef = useRef<HTMLDivElement>(null);
  if (open) lastChildren.current = children;

  useEffect(() => {
    if (open) {
      setRendered(true);
      // Next frame, so the 0 → content-height transition actually runs
      // instead of the panel appearing already open.
      const raf = requestAnimationFrame(() => setExpanded(true));
      return () => cancelAnimationFrame(raf);
    }
    setExpanded(false);
    const timer = window.setTimeout(() => setRendered(false), COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Click in the empty (transparent) area below, or Escape, collapses it.
  // Clicks on the bar itself are left to its buttons — e.g. tapping
  // Settings while Context is open switches panels instead of just closing.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element;
      if (panelRef.current?.contains(target)) return;
      if (target.closest?.(".compact-header, .title-bar, .header-dropdown")) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!rendered) return null;
  return (
    <div className="expand-panel" data-expanded={expanded} ref={panelRef}>
      <div className="expand-panel-clip">
        <div className="expand-panel-card">{open ? children : lastChildren.current}</div>
      </div>
    </div>
  );
}
