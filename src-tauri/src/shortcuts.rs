//! User-configurable global keyboard shortcuts (Settings → Shortcuts).
//!
//! Two actions can be bound: toggling the Interview/Meeting overlay (the
//! long-standing Ctrl+Shift+Space default) and toggling the main Smallbird
//! window (unbound until the user picks one). Bindings persist to
//! `shortcuts.json` in the app data dir — same load/save-to-AppData-JSON
//! pattern as `hardware::store` — and are registered at startup, before the
//! frontend has even loaded, so they work from the first second.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
use crate::crash_guard::LockExt;

const DEFAULT_TOGGLE_OVERLAY: &str = "Ctrl+Shift+Space";

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBindings {
    #[serde(default = "default_toggle_overlay")]
    pub toggle_overlay: Option<String>,
    #[serde(default)]
    pub toggle_main_window: Option<String>,
}

fn default_toggle_overlay() -> Option<String> {
    Some(DEFAULT_TOGGLE_OVERLAY.to_string())
}

impl Default for ShortcutBindings {
    fn default() -> Self {
        Self { toggle_overlay: default_toggle_overlay(), toggle_main_window: None }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Action {
    ToggleOverlay,
    ToggleMainWindow,
}

impl Action {
    const ALL: [Action; 2] = [Action::ToggleOverlay, Action::ToggleMainWindow];

    fn from_wire(s: &str) -> Result<Self, String> {
        match s {
            "toggleOverlay" => Ok(Action::ToggleOverlay),
            "toggleMainWindow" => Ok(Action::ToggleMainWindow),
            other => Err(format!("unknown shortcut action: {other}")),
        }
    }

    fn binding(self, b: &ShortcutBindings) -> Option<&String> {
        match self {
            Action::ToggleOverlay => b.toggle_overlay.as_ref(),
            Action::ToggleMainWindow => b.toggle_main_window.as_ref(),
        }
    }

    fn binding_mut(self, b: &mut ShortcutBindings) -> &mut Option<String> {
        match self {
            Action::ToggleOverlay => &mut b.toggle_overlay,
            Action::ToggleMainWindow => &mut b.toggle_main_window,
        }
    }

    fn default_binding(self) -> Option<String> {
        match self {
            Action::ToggleOverlay => default_toggle_overlay(),
            Action::ToggleMainWindow => None,
        }
    }
}

#[derive(Default)]
pub struct ShortcutManager {
    bindings: Mutex<ShortcutBindings>,
}

fn file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create app data directory: {e}"))?;
    Ok(dir.join("shortcuts.json"))
}

/// Missing/unreadable/corrupt file all mean "use the defaults". A saved
/// binding that fails `check_safe` (e.g. a Ctrl+Z saved before that check
/// existed) is dropped back to its default rather than hijacking undo in
/// every app on launch.
fn load(app: &AppHandle) -> ShortcutBindings {
    let mut bindings: ShortcutBindings = file_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    for action in Action::ALL {
        let unsafe_binding = action.binding(&bindings).is_some_and(|acc| check_safe(acc).is_err());
        if unsafe_binding {
            log::warn!("dropping unsafe saved shortcut for {action:?}, restoring its default");
            *action.binding_mut(&mut bindings) = action.default_binding();
            let _ = save(app, &bindings);
        }
    }
    bindings
}

fn save(app: &AppHandle, bindings: &ShortcutBindings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(bindings).map_err(|e| e.to_string())?;
    fs::write(file_path(app)?, json).map_err(|e| format!("failed to save shortcuts: {e}"))
}

fn parse(accelerator: &str) -> Result<Shortcut, String> {
    accelerator
        .parse::<Shortcut>()
        .map_err(|e| format!("\"{accelerator}\" isn't a valid shortcut: {e}"))
}

/// A global shortcut steals its combination from every other app, so a
/// single-modifier one like Ctrl+Z, Ctrl+C or Alt+Tab would break undo/copy/
/// window switching system-wide. Allowed: two or more of Ctrl/Alt/Shift, the
/// Win key with anything, or a function key. Mirrors the Settings recorder's
/// own check (ShortcutsPanel.tsx) — this is the backstop for a hand-edited
/// shortcuts.json.
fn check_safe(accelerator: &str) -> Result<(), String> {
    let parts: Vec<String> = accelerator.split('+').map(|p| p.trim().to_lowercase()).collect();
    let Some((key, mods)) = parts.split_last() else {
        return Err("empty shortcut".to_string());
    };
    let is_function_key = key.len() >= 2 && key.starts_with('f') && key[1..].parse::<u8>().is_ok();
    let has_win = mods.iter().any(|m| matches!(m.as_str(), "super" | "win" | "meta" | "cmd" | "command"));
    let common = mods
        .iter()
        .filter(|m| matches!(m.as_str(), "ctrl" | "control" | "alt" | "option" | "shift"))
        .count();
    if is_function_key || has_win || common >= 2 {
        Ok(())
    } else {
        Err(format!(
            "{accelerator} would stop working in every other app. Use two modifier keys, like Ctrl + Shift + K."
        ))
    }
}

/// Registers every bound shortcut. A failure (usually another app already
/// owns that combination) is logged, not fatal — the action stays reachable
/// from the UI, and Settings shows the binding so the user can change it.
fn register_all(app: &AppHandle, bindings: &ShortcutBindings) {
    for action in Action::ALL {
        if let Some(accelerator) = action.binding(bindings) {
            // Already ours (e.g. `set_shortcut` just registered it) — not a
            // failure, and re-registering would only log a spurious warning.
            if app.global_shortcut().is_registered(accelerator.as_str()) {
                continue;
            }
            if let Err(err) = app.global_shortcut().register(accelerator.as_str()) {
                log::warn!("failed to register global shortcut {accelerator} for {action:?}: {err}");
            }
        }
    }
}

/// Called once from `lib.rs`'s setup: loads saved bindings and registers them.
pub fn init(app: &AppHandle) {
    let bindings = load(app);
    register_all(app, &bindings);
    *app.state::<ShortcutManager>().bindings.lock_safe() = bindings;
}

/// The global-shortcut plugin's handler (key-down only — see `lib.rs`):
/// runs whichever action the pressed combination is bound to.
pub fn handle(app: &AppHandle, pressed: &Shortcut) {
    let manager = app.state::<ShortcutManager>();
    let action = {
        let bindings = manager.bindings.lock_safe();
        Action::ALL
            .into_iter()
            .find(|a| a.binding(&bindings).and_then(|acc| parse(acc).ok()).as_ref() == Some(pressed))
    };

    let result = match action {
        Some(Action::ToggleOverlay) => toggle_session(app),
        Some(Action::ToggleMainWindow) => toggle_main_window(app),
        None => Ok(()),
    };
    if let Err(err) = result {
        log::warn!("global shortcut action {action:?} failed: {err}");
    }
}

/// The overlay shortcut is a session switch: with the overlay open it
/// closes it (which ends the session — the main window stops audio capture
/// and the backend session on `interview-mode:overlay-closed`); otherwise
/// it asks the main window to start a session exactly like the Start button
/// (context, backend session, audio capture), showing the overlay at once.
/// Nothing is ever recorded unless this, or Start, was pressed.
fn toggle_session(app: &AppHandle) -> Result<(), String> {
    use tauri::Emitter;
    if session_active(app) {
        // Also cancels a start still in progress: closing emits
        // overlay-closed, which the main window treats as "cancel" while
        // starting (it then stops whatever did start).
        START_PENDING_SINCE_MS.store(0, Ordering::Relaxed);
        log::info!("shortcut: closing overlay (ends the session)");
        return crate::interview_mode::close_overlay_window(app);
    }
    START_PENDING_SINCE_MS.store(now_ms(), Ordering::Relaxed);
    log::info!("shortcut: session start requested");
    // Start recording right away (off the UI thread — WASAPI init takes a
    // moment); the session attaches to it once its key/connection are ready.
    let prebuffer_app = app.clone();
    std::thread::spawn(move || {
        if let Err(err) = crate::commands::begin_audio_prebuffer_inner(&prebuffer_app) {
            log::warn!("shortcut: couldn't start recording immediately: {err}");
        }
    });
    // Shown right here, on the key press (the window is pre-built at launch)
    // — not after a round trip through the main window's JS, which ranged
    // from ~20ms to ~2s. It reads "Starting to listen…" until capture is live.
    crate::interview_mode::show_overlay_window(app)?;
    app.emit_to(crate::main_window::MAIN_WINDOW_LABEL, "shortcut:start-session", ())
        .map_err(|e| format!("failed to ask the main window to start a session: {e}"))
}

/// When a shortcut-started session began starting (ms since epoch), 0 when
/// none is. Lets a second press cancel a start whose overlay/session isn't
/// fully up yet. Expires on its own in case the start never reports back.
static START_PENDING_SINCE_MS: AtomicU64 = AtomicU64::new(0);
const START_PENDING_MAX_MS: u64 = 20_000;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// A session is starting (shortcut pressed, not yet settled), live on the
/// backend, or its overlay is showing.
fn session_active(app: &AppHandle) -> bool {
    let pending = START_PENDING_SINCE_MS.load(Ordering::Relaxed);
    if pending != 0 && now_ms().saturating_sub(pending) < START_PENDING_MAX_MS {
        return true;
    }
    if crate::interview_mode::is_overlay_visible(app) {
        return true;
    }
    app.state::<crate::state::AppState>()
        .stt_session
        .lock_safe()
        .is_some()
}

/// The main window calls this once a shortcut-started session has finished
/// starting (successfully or not), so the next press is judged on the real
/// state again.
#[tauri::command]
pub fn shortcut_session_settled() {
    START_PENDING_SINCE_MS.store(0, Ordering::Relaxed);
}

/// Brings the main window forward (from the floating bubble, from behind
/// other windows, or hidden during a session); if it's already the active
/// window, tucks it back into the bubble — the same place the title bar's
/// minimize button sends it, since the main window has no taskbar entry.
fn toggle_main_window(app: &AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window(crate::main_window::MAIN_WINDOW_LABEL)
        .ok_or("main window not found")?;
    let visible = main.is_visible().unwrap_or(false);
    let focused = main.is_focused().unwrap_or(false);
    if visible && focused {
        crate::bubble_window::show_bubble_window(app)
    } else {
        crate::bubble_window::restore_from_bubble(app)
    }
}

#[tauri::command]
pub fn get_shortcuts(manager: State<'_, ShortcutManager>) -> Result<ShortcutBindings, String> {
    Ok(manager.bindings.lock_safe().clone())
}

/// Binds `action` to `accelerator` (e.g. "Ctrl+Alt+K"), or unbinds it when
/// `None`/blank. `reset: true` restores that action's default instead. On a
/// registration failure the previous binding is put back and the error is
/// returned, so a combination another app owns never leaves the action
/// silently unbound.
#[tauri::command]
pub fn set_shortcut(
    app: AppHandle,
    manager: State<'_, ShortcutManager>,
    action: String,
    accelerator: Option<String>,
    reset: Option<bool>,
) -> Result<ShortcutBindings, String> {
    let action = Action::from_wire(&action)?;
    let new_binding = if reset.unwrap_or(false) {
        action.default_binding()
    } else {
        accelerator.map(|a| a.trim().to_string()).filter(|a| !a.is_empty())
    };

    let mut bindings = manager.bindings.lock_safe();
    let old_binding = action.binding(&bindings).cloned();
    if new_binding == old_binding {
        return Ok(bindings.clone());
    }

    if let Some(new) = &new_binding {
        check_safe(new)?;
        let new_shortcut = parse(new)?;
        for other in Action::ALL.into_iter().filter(|a| *a != action) {
            if other.binding(&bindings).and_then(|acc| parse(acc).ok()) == Some(new_shortcut) {
                return Err(format!("{new} is already used by the other Smallbird shortcut."));
            }
        }
    }

    if let Some(old) = &old_binding {
        if app.global_shortcut().is_registered(old.as_str()) {
            let _ = app.global_shortcut().unregister(old.as_str());
        }
    }
    if let Some(new) = &new_binding {
        if let Err(err) = app.global_shortcut().register(new.as_str()) {
            if let Some(old) = &old_binding {
                let _ = app.global_shortcut().register(old.as_str());
            }
            log::warn!("failed to register global shortcut {new}: {err}");
            return Err(format!("Couldn't use {new} — another app may already be using it. Try a different combination."));
        }
    }

    *action.binding_mut(&mut bindings) = new_binding;
    save(&app, &bindings)?;
    Ok(bindings.clone())
}

/// While Settings is recording a new combination, every Smallbird shortcut
/// is paused — otherwise pressing an already-bound combination to re-assign
/// it would also fire it (e.g. hide the overlay mid-recording).
#[tauri::command]
pub fn suspend_shortcuts(app: AppHandle, manager: State<'_, ShortcutManager>, suspended: bool) -> Result<(), String> {
    let bindings = manager.bindings.lock_safe().clone();
    if suspended {
        app.global_shortcut().unregister_all().map_err(|e| e.to_string())
    } else {
        register_all(&app, &bindings);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_keep_the_existing_overlay_hotkey() {
        let b = ShortcutBindings::default();
        assert_eq!(b.toggle_overlay.as_deref(), Some("Ctrl+Shift+Space"));
        assert!(b.toggle_main_window.is_none());
    }

    #[test]
    fn partial_file_falls_back_to_defaults_per_field() {
        let b: ShortcutBindings = serde_json::from_str(r#"{"toggleMainWindow":"Ctrl+Alt+S"}"#).unwrap();
        assert_eq!(b.toggle_overlay.as_deref(), Some("Ctrl+Shift+Space"));
        assert_eq!(b.toggle_main_window.as_deref(), Some("Ctrl+Alt+S"));
    }

    #[test]
    fn explicitly_cleared_overlay_binding_stays_cleared() {
        let b: ShortcutBindings = serde_json::from_str(r#"{"toggleOverlay":null}"#).unwrap();
        assert!(b.toggle_overlay.is_none());
    }

    #[test]
    fn accelerators_from_the_settings_recorder_parse() {
        for acc in ["Ctrl+Shift+Space", "Ctrl+Alt+S", "Super+Shift+1", "Alt+F9", "Ctrl+Shift+ArrowUp"] {
            assert!(parse(acc).is_ok(), "{acc} should parse");
        }
        assert_eq!(parse("Ctrl+Shift+Space").unwrap(), parse("shift+ctrl+space").unwrap());
    }

    #[test]
    fn single_modifier_shortcuts_are_rejected() {
        for acc in ["Ctrl+Z", "Ctrl+X", "Alt+Tab", "Shift+A", "K"] {
            assert!(check_safe(acc).is_err(), "{acc} should be rejected");
        }
        for acc in ["Ctrl+Shift+Space", "Ctrl+Alt+S", "Super+K", "F9", "Alt+F9", "Alt+Shift+1"] {
            assert!(check_safe(acc).is_ok(), "{acc} should be allowed");
        }
    }
}
