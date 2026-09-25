import { Component, type ErrorInfo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

/// Records a frontend failure in the app's log file (see
/// crash_guard::log_frontend_error in Rust) — a release build has no devtools
/// console, so without this a crash in a user's window leaves no trace.
/// Never throws: error reporting must not become a new source of errors.
export function reportFrontendError(kind: string, error: unknown, extra?: string) {
  try {
    const detail =
      error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error);
    invoke("log_frontend_error", { message: `${kind}: ${detail}${extra ? `\n${extra}` : ""}` }).catch(() => {});
  } catch {
    // Nothing sensible left to do.
  }
}

/// Catches uncaught *window-level* errors (event handlers, timers, promise
/// chains without a .catch) and logs them. Those don't unmount React, so no
/// UI is shown for them — the ErrorBoundary below covers render crashes.
export function installGlobalErrorHandlers() {
  window.addEventListener("error", (event) => {
    reportFrontendError("uncaught error", event.error ?? event.message, `at ${event.filename}:${event.lineno}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportFrontendError("unhandled promise rejection", event.reason);
  });
}

interface Props {
  children: ReactNode;
  /// "compact" is for the tiny bubble window, which has no room for text.
  variant?: "full" | "compact";
}

interface State {
  error: Error | null;
}

/// A render crash anywhere below this used to unmount the whole React tree,
/// leaving a blank (and, for the transparent overlay, completely invisible)
/// window with no way back short of restarting the app. This shows a
/// recoverable screen instead.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportFrontendError("render crash", error, info.componentStack ?? undefined);
  }

  private retry = () => this.setState({ error: null });

  private reload = () => window.location.reload();

  render() {
    if (!this.state.error) return this.props.children;

    if (this.props.variant === "compact") {
      return (
        <button type="button" className="crash-fallback-compact" onClick={this.reload} title="Something went wrong — click to reload">
          ↻
        </button>
      );
    }

    return (
      <div className="crash-fallback" role="alert">
        <div className="crash-fallback-card">
          <h2>Something went wrong</h2>
          <p>
            This window hit an unexpected error. Anything already saved is safe — try again, or reload the window.
          </p>
          <div className="crash-fallback-actions">
            <button type="button" className="crash-fallback-btn" onClick={this.retry}>
              Try again
            </button>
            <button type="button" className="crash-fallback-btn crash-fallback-btn-primary" onClick={this.reload}>
              Reload window
            </button>
          </div>
        </div>
      </div>
    );
  }
}
