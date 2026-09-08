//! Shared frameless/always-on-top overlay window mechanics, parameterized by
//! window label — used by Interview Mode via `interview_mode::window`, which
//! just calls through to this module with its own label/title baked in.

use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{
    window::Color, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::main_window::MAIN_WINDOW_LABEL;
use crate::state::AppState;
use crate::windows_capture_protection;

const OVERLAY_FALLBACK_SIDE: f64 = 560.0;
// Was 0.75 ("large") back when this was the baseline for a *square* window.
// Combined with OVERLAY_HEIGHT_BOOST below it now made every fresh overlay
// open nearly full-screen-tall, which read as "opening too big" — dialed
// back so the default open is comfortably sized, with "large" still
// available deliberately via the resize icon (see SIZE_FRACTIONS).
const DEFAULT_SIZE_FRACTION: f64 = 0.48;

/// The header's pill toolbar (Answer/Screenshot/Chat + move/resize/more/End)
/// needs meaningfully more horizontal room than the window is tall — the
/// overlay used to be a plain square (`side x side`), which clipped or
/// overflowed that row. Width is this multiple of the height instead;
/// `overlay_dimensions` below is the one place that math lives.
const OVERLAY_WIDTH_RATIO: f64 = 1.7;

/// Absolute floor on top of `overlay_dimensions`' own math — the action
/// bar's three pill buttons (each carrying a keyboard-shortcut hint) plus
/// the mic/speaker status icons and the move/resize/more/End controls need
/// this much room laid out in one row without wrapping or clipping,
/// regardless of what fraction-of-screen math would otherwise produce at
/// the "small" preset on a modest display.
// Was 700 — the action bar's pill buttons dropped their inline keyboard-hint
// text since this was last tuned, so they need less horizontal room now.
const OVERLAY_MIN_WIDTH: f64 = 640.0;

/// Height gets more room than the old square math gave it, independent of
/// width — the three stacked bars (action bar, transcript bar, main panel)
/// need vertical space of their own, not just whatever falls out of matching
/// the width ratio. Multiplies the same fraction-of-screen baseline width
/// derives from, so the two scale independently rather than one inflating
/// the other.
const OVERLAY_HEIGHT_BOOST: f64 = 1.35;

/// From a monitor size and a size fraction, computes (width, height) for the
/// overlay. Both start from the same baseline — `fraction` of the monitor's
/// shorter side (the value the old square sizing used directly as its one
/// side) — then scale independently: height by `OVERLAY_HEIGHT_BOOST`, width
/// by `OVERLAY_WIDTH_RATIO`, each with its own floor. Width is capped so it
/// never exceeds the monitor's own width (with a small margin so the window
/// never touches both screen edges at once); height is capped against the
/// monitor's height minus `TOP_MARGIN` and a matching bottom margin, since
/// the window is now anchored at top-center (see `center_overlay_on_screen`)
/// rather than vertically centered, so it has to fit below that margin
/// without running off the bottom of the screen.
fn overlay_dimensions(monitor_size: LogicalSize<f64>, fraction: f64, min_height: f64) -> (f64, f64) {
    let baseline = monitor_size.width.min(monitor_size.height) * fraction;
    let height = (baseline * OVERLAY_HEIGHT_BOOST)
        .max(min_height)
        .min(monitor_size.height - TOP_MARGIN * 2.0);
    let width = (baseline * OVERLAY_WIDTH_RATIO)
        .max(OVERLAY_MIN_WIDTH)
        .min(monitor_size.width - 40.0);
    (width, height)
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct OverlayCaptureStatus {
    pub excluded: bool,
}

/// Creates the overlay window (if it doesn't exist), centers it on the
/// primary monitor (see `center_overlay_on_screen`), applies capture
/// exclusion, shows it, then hides the main window so the overlay is the
/// only thing visible — hidden LAST, only once the overlay is actually
/// positioned/shown, so there's no visible gap where the app looks like it
/// closed. `title` is the OS window title; `label` gives this overlay its
/// own window identity.
pub fn show_overlay_window(app: &AppHandle, label: &str, title: &str) -> Result<OverlayCaptureStatus, String> {
    let desired = capture_protection_desired(app);
    let excluded = if let Some(existing) = app.get_webview_window(label) {
        // Reset the frontend's session-scoped React state before showing a
        // *reused* overlay window (the WebView2 process/DOM is never torn
        // down between close and reopen — only hidden) — otherwise stale
        // state from the previous session could still be showing the
        // instant this window reappears, before any of this new session's
        // events have even arrived. Best-effort: the webview may not have a
        // listener registered yet on the very first reuse, which is fine —
        // there's nothing stale to clear at that point anyway.
        let _ = existing.emit("overlay:reset-session", ());
        center_overlay_on_screen(&existing, false);
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        // Only reassert exclusion if the user hasn't explicitly turned it
        // off — reusing this window (close/reopen) must not silently
        // override a prior "Screen Capture Protection: off" choice.
        apply_desired_exclusion(&existing, desired)
    } else {
        let window = build_overlay_window(app, label, title)?;
        center_overlay_on_screen(&window, true);

        let excluded = apply_desired_exclusion(&window, desired);
        if desired {
            if excluded {
                log::info!("overlay '{label}': screen-capture exclusion ENABLED");
            } else {
                log::warn!("overlay '{label}': screen-capture exclusion FAILED/UNAVAILABLE");
            }
        }

        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        excluded
    };

    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if let Err(e) = main.hide() {
            log::warn!("failed to hide main window when entering overlay '{label}': {e}");
        }
    }

    Ok(OverlayCaptureStatus { excluded })
}

/// Hides the overlay and brings the main window back, since it's hidden on
/// entry (see `show_overlay_window`).
///
/// Also emits `interview-mode:overlay-closed` to every window: the overlay
/// and main window are separate webviews with no shared React state, so the
/// main window's own session status has no other way to learn the overlay
/// closed unless it was the one that called this.
pub fn close_overlay_window(app: &AppHandle, label: &str) -> Result<(), String> {
    log::info!("close_overlay_window '{label}': on main thread, hiding");
    if let Some(window) = app.get_webview_window(label) {
        window.hide().map_err(|e| e.to_string())?;
    }
    log::info!("close_overlay_window '{label}': overlay hidden, showing main");
    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    log::info!("close_overlay_window '{label}': main shown, emitting event");
    let _ = app.emit("interview-mode:overlay-closed", ());
    log::info!("close_overlay_window '{label}': done");
    Ok(())
}

pub fn toggle_overlay_window(app: &AppHandle, label: &str, title: &str) -> Result<OverlayCaptureStatus, String> {
    if let Some(window) = app.get_webview_window(label) {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            close_overlay_window(app, label)?;
            return Ok(OverlayCaptureStatus { excluded: is_capture_excluded(app, label) });
        }
    }
    show_overlay_window(app, label, title)
}

pub fn is_capture_excluded(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label).is_some()
}

pub fn set_overlay_always_on_top(app: &AppHandle, label: &str, enabled: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        window.set_always_on_top(enabled).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Toggles `WDA_EXCLUDEFROMCAPTURE` on/off — the Settings panel's "Screen
/// Capture Protection" row was previously a status readout with nothing
/// behind it to actually flip (`disable_capture_exclusion` sat unused). This
/// is the real switch: some screen-share/screenshot pipelines are still on
/// the legacy GDI capture path, where Windows itself renders an excluded
/// window as a solid black rectangle instead of properly omitting it (a
/// platform-level fallback, not something either side of this call can
/// override) — a candidate who'd rather have the overlay plainly *visible*
/// than show as an unexplained black box needs a way to turn protection off
/// entirely, not just live with whichever behavior their capture pipeline
/// happens to pick.
pub fn set_overlay_capture_exclusion(app: &AppHandle, label: &str, enabled: bool) -> Result<OverlayCaptureStatus, String> {
    // Record the user's actual intent first — the watchdog (see
    // `spawn_capture_protection_watchdog`) reads this on every tick, so it
    // has to be updated before/regardless of whether the immediate Win32
    // call below succeeds.
    if let Some(state) = app.try_state::<AppState>() {
        state.overlay_capture_protection_desired.store(enabled, Ordering::Relaxed);
    }
    let Some(window) = app.get_webview_window(label) else {
        return Err(format!("overlay window '{label}' is not open"));
    };
    if enabled {
        let excluded = windows_capture_protection::enable_capture_exclusion(&window).is_ok();
        Ok(OverlayCaptureStatus { excluded })
    } else {
        windows_capture_protection::disable_capture_exclusion(&window)?;
        Ok(OverlayCaptureStatus { excluded: false })
    }
}

fn capture_protection_desired(app: &AppHandle) -> bool {
    app.try_state::<AppState>()
        .map(|s| s.overlay_capture_protection_desired.load(Ordering::Relaxed))
        .unwrap_or(true)
}

/// Applies (or removes) capture exclusion on `window` to match `desired`,
/// returning whether it ends up excluded. Centralizes the "respect the
/// user's toggle, don't just always turn exclusion on" logic shared by
/// `show_overlay_window` and the watchdog below.
fn apply_desired_exclusion(window: &WebviewWindow, desired: bool) -> bool {
    if desired {
        windows_capture_protection::enable_capture_exclusion(window).is_ok()
    } else {
        let _ = windows_capture_protection::disable_capture_exclusion(window);
        false
    }
}

/// Periodically re-asserts the overlay's screen-capture exclusion while it's
/// visible, guarding against `SetWindowDisplayAffinity` silently reverting
/// (observed after monitor/DPI changes, GPU driver resets, and waking from
/// sleep — none of which fire an event this process can hook). Idempotent
/// and cheap, so re-applying on a timer is safe even when nothing actually
/// reset. Only re-applies when the user's own toggle (tracked in
/// `AppState::overlay_capture_protection_desired`) wants it on — never
/// fights an explicit "off".
///
/// This does NOT fix the separate, unrelated platform limitation where some
/// legacy/GDI-based capture pipelines render an excluded window as a solid
/// black rectangle instead of properly omitting it (see
/// `windows_capture_protection`'s module docs) — that's a Windows compositor
/// behavior with no software workaround from this side, which is why the
/// Settings panel's toggle exists as an escape hatch. This watchdog only
/// guards against exclusion silently *not being active at all* when it was
/// supposed to be.
pub fn spawn_capture_protection_watchdog(app: AppHandle, label: &'static str) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3));
        loop {
            interval.tick().await;
            let Some(window) = app.get_webview_window(label) else {
                continue;
            };
            if !window.is_visible().unwrap_or(false) {
                continue;
            }
            let desired = capture_protection_desired(&app);
            if desired {
                let _ = windows_capture_protection::enable_capture_exclusion(&window);
            }
        }
    });
}

/// Same self-healing reassertion as `spawn_capture_protection_watchdog`, but
/// for windows with no user-facing on/off toggle (the main window) —
/// unconditionally keeps exclusion asserted whenever the window is visible,
/// no `AppState` flag to consult.
pub fn spawn_unconditional_capture_protection_watchdog(app: AppHandle, label: &'static str) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3));
        loop {
            interval.tick().await;
            let Some(window) = app.get_webview_window(label) else {
                continue;
            };
            if window.is_visible().unwrap_or(false) {
                let _ = windows_capture_protection::enable_capture_exclusion(&window);
            }
        }
    });
}

pub fn resize_overlay(app: &AppHandle, label: &str, fraction: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window(label) else {
        return Ok(());
    };
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale = monitor.scale_factor();
        let monitor_size = monitor.size().to_logical::<f64>(scale);
        let (width, height) = overlay_dimensions(monitor_size, fraction, 520.0);
        let _ = window.set_size(LogicalSize::new(width, height));
    }
    center_overlay_on_screen(&window, false);
    Ok(())
}

fn build_overlay_window(app: &AppHandle, label: &str, title: &str) -> Result<WebviewWindow, String> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(OVERLAY_FALLBACK_SIDE * OVERLAY_WIDTH_RATIO, OVERLAY_FALLBACK_SIDE)
        // Width floor is wide enough for the action bar's three pill buttons
        // (with their keyboard-shortcut hints) plus the move/resize/more/End
        // controls without clipping or overflowing.
        .min_inner_size(OVERLAY_MIN_WIDTH, 320.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| format!("failed to create overlay window '{label}': {e}"))
}

/// How far above true vertical center the overlay sits, so it reads as
/// docked close to the app's toolbar rather than dead-center of the screen
/// — the main window itself always opens near the top of the screen (see
/// main_window.rs's `position_top_center`/`TOP_MARGIN`), so the overlay
/// should land close to it rather than drifting toward the middle of a
/// tall monitor.
const TOP_MARGIN: f64 = 24.0;

/// Positions the overlay at top-center of the primary monitor — horizontally
/// exactly centered, vertically anchored `TOP_MARGIN` below the top edge
/// rather than vertically centered. If `apply_default_size` is set (only
/// true right after `build_overlay_window` creates a brand-new window), also
/// sizes it first via `overlay_dimensions`. `resize_overlay` sets its own
/// explicit size before calling this purely for repositioning, so it always
/// passes `false`.
///
/// Always computed from the monitor and the overlay's own *intended* size
/// (recomputed here with the same `DEFAULT_SIZE_FRACTION` math
/// `apply_default_size` uses, rather than read back via
/// `window.outer_size()`) — reading the size back immediately after
/// `set_size()` isn't guaranteed to reflect the new size yet on every
/// platform, and using a stale/default size there was the actual cause of
/// the overlay occasionally landing at an unrelated position on screen.
/// This intentionally doesn't depend on the main window's own position at
/// all — the main window is about to be hidden right after this runs
/// anyway (see `show_overlay_window`), so anchoring to a window that's
/// mid-hide was also part of the inconsistency.
fn center_overlay_on_screen(window: &WebviewWindow, apply_default_size: bool) {
    let Ok(Some(monitor)) = window.primary_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let monitor_size = monitor.size().to_logical::<f64>(scale);
    let monitor_pos = monitor.position().to_logical::<f64>(scale);

    let (width, height) = if apply_default_size {
        let dims = overlay_dimensions(monitor_size, DEFAULT_SIZE_FRACTION, 560.0);
        let _ = window.set_size(LogicalSize::new(dims.0, dims.1));
        dims
    } else {
        window
            .outer_size()
            .map(|s| {
                let logical = s.to_logical::<f64>(scale);
                (logical.width, logical.height)
            })
            .unwrap_or_else(|_| overlay_dimensions(monitor_size, DEFAULT_SIZE_FRACTION, 560.0))
    };

    let x = monitor_pos.x + (monitor_size.width - width) / 2.0;
    let y = monitor_pos.y + TOP_MARGIN;
    let _ = window.set_position(LogicalPosition::new(x, y));

    // Moving/resizing to a (possibly different-DPI) monitor is one of the
    // known triggers for Windows silently dropping WDA_EXCLUDEFROMCAPTURE —
    // reassert immediately rather than waiting for the watchdog's next tick,
    // so there's no window where a dragged-to-another-monitor overlay is
    // briefly capturable. Respects the user's own toggle, same as the
    // watchdog.
    if capture_protection_desired(window.app_handle()) {
        let _ = windows_capture_protection::enable_capture_exclusion(window);
    }
}
