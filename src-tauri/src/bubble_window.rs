//! The small floating logo widget that minimize/close can collapse the main
//! window into instead of a real OS minimize (which, combined with
//! `skip_taskbar`, would leave the user with no way to get the window back —
//! see main_window.rs's own doc comment on why the main window skips the
//! taskbar). Clicking the bubble restores the main window; the bubble's own
//! close affordance (rendered in BubbleWidget.tsx) quits the app via the
//! existing `quit_app` command.

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::main_window::MAIN_WINDOW_LABEL;
use crate::windows_capture_protection;

pub const BUBBLE_WINDOW_LABEL: &str = "bubble";

// A little bigger than the 56px logo circle rendered inside it
// (BubbleWidget.tsx/bubble.css), so the close (X) affordance has room to
// sit just outside the logo's edge without being clipped by the window
// bounds. Dragging is handled manually in BubbleWidget.tsx (not via
// data-tauri-drag-region, which skips interactive elements and would only
// leave the thin margin around the logo grabbable), so this no longer needs
// to reserve a drag ring specifically.
const BUBBLE_SIDE: f64 = 72.0;
// Clear of the taskbar and screen edge on every Windows taskbar position
// (bottom is the common case) without needing to detect where it actually
// is.
const BUBBLE_MARGIN: f64 = 24.0;

/// Creates the bubble window up front (hidden) during app startup, so the
/// first Minimize doesn't pay for building a fresh `WebviewWindow` and
/// loading/mounting its page — the perceptible "little time" delay on the
/// very first toggle. Every later toggle already only shows/hides the same
/// window (see `show_bubble_window`/`restore_from_bubble`) and was already
/// fast; this just makes the first one match.
///
/// Capture exclusion is applied here too, before the window is ever
/// positioned/shown — same ordering `lib.rs`'s setup uses for the main
/// window, and for the same reason: doing it after the window is already
/// shown was observed to knock DWM into minimizing it.
pub fn ensure_bubble_window(app: &AppHandle) {
    if app.get_webview_window(BUBBLE_WINDOW_LABEL).is_some() {
        return;
    }
    match build_bubble_window(app) {
        Ok(window) => {
            // Deliberately does NOT apply capture exclusion here. This window
            // is pre-created hidden and may stay hidden indefinitely, and a
            // hidden window carrying `WDA_EXCLUDEFROMCAPTURE` leaves a black
            // rectangle at its bounds in an already-running screen share (see
            // `windows_capture_protection::release_after_hide`). Exclusion is
            // applied by `show_bubble_window` before it is ever made visible.
            position_bottom_right(&window);
        }
        Err(err) => log::warn!("ensure_bubble_window: failed to pre-create bubble window: {err}"),
    }
}

/// Shows the floating bubble (creating it first if `ensure_bubble_window`
/// hasn't already) positioned at the bottom-right of the primary monitor,
/// then hides the main window — mirrors
/// `overlay_window::show_overlay_window`'s hide-main-last ordering so there's
/// no visible gap where the app looks like it quit.
pub fn show_bubble_window(app: &AppHandle) -> Result<(), String> {
    let is_new = app.get_webview_window(BUBBLE_WINDOW_LABEL).is_none();
    let window = if let Some(existing) = app.get_webview_window(BUBBLE_WINDOW_LABEL) {
        existing
    } else {
        build_bubble_window(app)?
    };
    log::info!("show_bubble_window: is_new={is_new}");
    // Only snap to the default corner the first time this window exists —
    // once the user has dragged it, later Minimizes should reopen it where
    // they left it rather than resetting the position on every toggle.
    if is_new {
        position_bottom_right(&window);
    }
    // Reassert on every show, not just at creation — the watchdog spawned in
    // lib.rs only reasserts while the window is already visible, so a drop
    // that happens while the bubble is hidden (e.g. the app minimized to it,
    // the machine slept, then it's shown again) would otherwise go
    // unnoticed until the watchdog's next tick.
    windows_capture_protection::reconcile(&window, BUBBLE_WINDOW_LABEL, true);
    window.show().map_err(|e| e.to_string())?;
    log::info!(
        "show_bubble_window: after show(), is_visible={:?} outer_position={:?}",
        window.is_visible(),
        window.outer_position()
    );

    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        main.hide().map_err(|e| e.to_string())?;
        windows_capture_protection::release_after_hide(&main, MAIN_WINDOW_LABEL);
        log::info!("show_bubble_window: after main.hide(), main is_visible={:?}", main.is_visible());
    }
    Ok(())
}

/// Hides the bubble and brings the main window back — called when the user
/// clicks the bubble's logo.
pub fn restore_from_bubble(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(BUBBLE_WINDOW_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
        windows_capture_protection::release_after_hide(&window, BUBBLE_WINDOW_LABEL);
    }
    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        // Same reasoning as `overlay_window::close_overlay_window`'s
        // matching fix: the main window has been hidden (and therefore
        // unchecked by the watchdog, which skips invisible windows) for
        // however long the bubble was up — reconcile before it reappears
        // rather than trusting whatever exclusion state it left hidden
        // with. `reconcile` only ever touches the display-affinity window
        // property, never position/size/frame.
        windows_capture_protection::reconcile(&main, MAIN_WINDOW_LABEL, true);
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn build_bubble_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    let event_app = app.clone();
    WebviewWindowBuilder::new(app, BUBBLE_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
        .title("SmallBird AI")
        .inner_size(BUBBLE_SIDE, BUBBLE_SIDE)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| format!("failed to create bubble window: {e}"))
        .inspect(|window| {
            // See the matching comment in `overlay_window::build_overlay_window`
            // — reacts immediately to a real OS monitor/DPI/move notification
            // instead of waiting for the watchdog's next tick.
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::ScaleFactorChanged { .. } | tauri::WindowEvent::Moved(_)) {
                    let Some(window) = event_app.get_webview_window(BUBBLE_WINDOW_LABEL) else {
                        return;
                    };
                    windows_capture_protection::reconcile(&window, BUBBLE_WINDOW_LABEL, true);
                }
            });
        })
}

fn position_bottom_right(window: &WebviewWindow) {
    let monitor_result = window.primary_monitor();
    let Ok(Some(monitor)) = monitor_result else {
        log::warn!("position_bottom_right: no primary monitor: {monitor_result:?}");
        return;
    };
    let scale = monitor.scale_factor();
    let monitor_size = monitor.size().to_logical::<f64>(scale);
    let monitor_pos = monitor.position().to_logical::<f64>(scale);

    let x = monitor_pos.x + monitor_size.width - BUBBLE_SIDE - BUBBLE_MARGIN;
    let y = monitor_pos.y + monitor_size.height - BUBBLE_SIDE - BUBBLE_MARGIN;
    log::info!("position_bottom_right: target=({x},{y}) monitor_size={monitor_size:?}");
    let _ = window.set_position(LogicalPosition::new(x, y));
    let _ = window.set_size(LogicalSize::new(BUBBLE_SIDE, BUBBLE_SIDE));
}
