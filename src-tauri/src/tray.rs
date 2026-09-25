//! Keeps Smallbird running in the background (system tray) so its global
//! shortcuts (see `shortcuts`) keep working after the user closes it. A
//! global shortcut only fires while some process is listening for it — once
//! the app process exits, nothing can bring it back — so closing the main
//! window (or the bubble's X) now hides everything to a tray icon instead of
//! quitting. The tray icon's menu is the one real way out ("Quit
//! Smallbird"), and with `start with Windows` on (see `autostart`), the app
//! is already running hidden after a reboot too.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;
use crate::windows_capture_protection;

const TRAY_ID: &str = "smallbird-tray";
const MENU_OPEN: &str = "open";
const MENU_QUIT: &str = "quit";

/// Builds the tray icon once at startup. Left-click (or "Open Smallbird")
/// brings the main window back; "Quit Smallbird" ends any live session and
/// actually exits.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, MENU_OPEN, "Open Smallbird", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, MENU_QUIT, "Quit Smallbird", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Smallbird — running in the background (shortcuts are active)")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN => show_main(app),
            MENU_QUIT => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Brings the main window forward — from the tray, the bubble, or behind
/// other windows. Same path the bubble's own click uses.
fn show_main(app: &AppHandle) {
    if let Err(err) = crate::bubble_window::restore_from_bubble(app) {
        log::warn!("tray: failed to show main window: {err}");
    }
}

/// "Quit Smallbird": the one path that really exits. Stops capture and ends
/// the metered backend session first (best-effort) so quitting mid-session
/// doesn't leave the session running until the server's stale sweep.
fn quit(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        {
            let state = app.state::<AppState>();
            let _ = crate::commands::stop_audio_capture(app.clone(), state);
        }
        let _ = crate::interview_mode::commands::end_backend_session(app.state::<AppState>()).await;
        app.exit(0);
    });
}

/// Hides every Smallbird window (main, bubble, overlay) instead of quitting,
/// leaving only the tray icon — the process, and so its global shortcuts,
/// keep running. If the overlay was up, `interview-mode:overlay-closed` is
/// emitted so the main window resets to idle and ends the session, exactly
/// as when the overlay is closed from its own controls.
fn hide_all(app: &AppHandle) -> Result<(), String> {
    let overlay_label = crate::interview_mode::OVERLAY_WINDOW_LABEL;
    let mut overlay_was_visible = false;
    for label in [overlay_label, crate::bubble_window::BUBBLE_WINDOW_LABEL, crate::main_window::MAIN_WINDOW_LABEL] {
        if let Some(window) = app.get_webview_window(label) {
            if window.is_visible().unwrap_or(false) {
                overlay_was_visible |= label == overlay_label;
                window.hide().map_err(|e| e.to_string())?;
                // Must follow the hide — see `release_after_hide`.
                windows_capture_protection::release_after_hide(&window, label);
            }
        }
    }
    if overlay_was_visible {
        let _ = app.emit("interview-mode:overlay-closed", ());
    }
    Ok(())
}

/// Called by the main window's close (✕ / Alt+F4) and the bubble's X. Runs
/// the window work on the main thread — see `commands::run_on_main` for why
/// window show/hide can't run on Tauri's command thread pool.
#[tauri::command]
pub async fn hide_to_tray(app: AppHandle) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let app_for_main = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(hide_all(&app_for_main));
    })
    .map_err(|e| format!("failed to schedule work on main thread: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().map_err(|e| format!("main-thread task did not respond: {e}"))?)
        .await
        .map_err(|e| format!("main-thread task panicked: {e}"))?
}
