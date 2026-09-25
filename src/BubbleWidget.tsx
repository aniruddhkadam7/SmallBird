import { useCallback, useRef, useState, type PointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import smallbirdLogo from "./assets/smallbird-logo.png";
import "./bubble.css";

// Distance (px) the pointer has to move before a press-and-hold on the logo
// counts as a drag rather than a click. Below this, releasing restores the
// main window instead.
const DRAG_THRESHOLD = 4;

// Rendered in the small floating "bubble" window that minimize/close
// collapses into instead of a real OS minimize (see bubble_window.rs for
// why: the main window is skip_taskbar, so a real minimize would have no
// taskbar entry to restore it from). Clicking the logo restores the main
// window; the close affordance (only shown on hover, since the bubble is
// tiny) quits the app entirely.
//
// Dragging is handled manually (startDragging()) rather than via
// data-tauri-drag-region: that mechanism skips interactive elements (see
// bubble_window.rs's BUBBLE_SIDE comment), so a plain drag-region would only
// let you grab the couple of pixels of margin around the button — easy to
// miss entirely. This makes the whole logo both draggable and clickable, the
// same way a chat-head bubble works: press-and-hold-and-move drags, a plain
// press-and-release clicks.
export function BubbleWidget() {
  const [hovering, setHovering] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);

  const handlePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    didDrag.current = false;
    // Without capture, a fast press-and-move can carry the pointer outside
    // this element's (56px) bounds before the drag threshold is reached —
    // pointermove then stops firing here at all, since the element under
    // the cursor is no longer this one, so the drag was never detected.
    // Capturing keeps every move event routed here regardless of where the
    // cursor physically ends up, for as long as the button stays down.
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || didDrag.current) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      didDrag.current = true;
      invoke("drag_bubble_window");
    }
  }, []);

  const handlePointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current && !didDrag.current) {
      invoke("restore_from_bubble");
    }
    dragStart.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  return (
    <div
      className="bubble-root"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div
        className="bubble-logo-btn"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="button"
        aria-label="Restore Smallbird"
        title="Restore Smallbird (drag to move)"
      >
        <img src={smallbirdLogo} alt="" draggable={false} />
      </div>
      {hovering && (
        <button
          className="bubble-close-btn"
          onClick={(e) => {
            e.stopPropagation();
            // Hides to the system tray instead of quitting, so global
            // shortcuts keep working — the tray menu's "Quit Smallbird" is
            // the real exit (see tray.rs).
            invoke("hide_to_tray");
          }}
          aria-label="Close Smallbird (keeps running in the tray)"
          title="Close (Smallbird keeps running in the tray — quit from the tray icon)"
        >
          ✕
        </button>
      )}
    </div>
  );
}
