import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import { InterviewOverlay } from "./InterviewOverlay";
import { BubbleWidget } from "./BubbleWidget";
import { ErrorBoundary, installGlobalErrorHandlers } from "./ErrorBoundary";
import "./tailwind.css";
import "./overlay.css";
import "./bubble.css";

// The overlay/bubble windows load the exact same index.html/bundle as the
// main window (Tauri's WebviewUrl::App points all of them at "index.html")
// — which root component renders is decided here by the window's label, set
// when each window is created in Rust.
const FIXED_OVERLAY_LABELS = new Set(["interview-overlay"]);

// Before anything renders, so errors thrown during startup are recorded too.
installGlobalErrorHandlers();

const label = getCurrentWebviewWindow().label;
const isOverlay = FIXED_OVERLAY_LABELS.has(label);
const isBubble = label === "bubble";
if (isOverlay) {
  document.body.classList.add("overlay-window");
  // Also mark <html>. Vite bundles every stylesheet into one file regardless
  // of which component imported it, so App.css's `html, body { background }`
  // rule reaches this window too and would paint an opaque canvas behind the
  // overlay — defeating the window's transparency. Marking the root element
  // lets overlay.css override it by specificity, without depending on CSS
  // `:has()` support in whatever WebView2 version is installed.
  document.documentElement.classList.add("overlay-window");
}
if (isBubble) {
  // Same reasoning as the overlay's own marking above, via bubble.css.
  document.body.classList.add("bubble-window");
  document.documentElement.classList.add("bubble-window");
}

function Root() {
  if (label === "interview-overlay") return <InterviewOverlay />;
  if (label === "bubble") return <BubbleWidget />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary variant={isBubble ? "compact" : "full"}>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);

// See `commands::signal_window_content_ready` in Rust for why this exists:
// screen-capture exclusion is applied to this window before it has any
// content (while still hidden, right after creation) — WebView2 attaches its
// own compositor visual asynchronously as content actually loads, and if
// that happens after DWM has already built its capture-facing composition
// for this window, the exclusion can end up rendering as a black box to
// screen-share viewers for the rest of this window's life. Reasserting once
// a real frame has actually been painted (the rAF) gives DWM a fully
// initialized window to compose from. Runs once per window (main, overlay,
// and bubble all load this same entry point).
requestAnimationFrame(() => {
  invoke("signal_window_content_ready").catch(() => {});
});
