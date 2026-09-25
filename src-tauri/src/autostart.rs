//! "Start Smallbird when Windows starts" — on by default, so the tray
//! process (and with it the global shortcuts, see `tray`/`shortcuts`) is
//! already running after a reboot. Launched at login with `--autostart`,
//! the app starts hidden in the tray instead of popping its window up.
//!
//! "On by default" is applied once per install (first launch of a release
//! build), recorded in `app_prefs.json`; after that the user's own choice in
//! Settings → Shortcuts sticks, including turning it off.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

pub const AUTOSTART_ARG: &str = "--autostart";

#[derive(Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppPrefs {
    #[serde(default)]
    autostart_default_applied: bool,
}

fn prefs_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("app_prefs.json"))
}

/// True when this process was launched by Windows at login (see
/// `tauri_plugin_autostart::init`'s args in `lib.rs`) — the main window then
/// stays hidden and only the tray icon appears.
pub fn launched_at_login() -> bool {
    std::env::args().any(|a| a == AUTOSTART_ARG)
}

/// Turns autostart on the first time an installed (release) build runs.
/// Skipped in debug builds: a `tauri dev` run would otherwise register the
/// developer's debug executable to launch at every login.
pub fn apply_default(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let Some(path) = prefs_path(app) else { return };
    let mut prefs: AppPrefs = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    if prefs.autostart_default_applied {
        return;
    }
    match app.autolaunch().enable() {
        Ok(()) => log::info!("autostart: enabled by default on first run"),
        Err(err) => log::warn!("autostart: failed to enable by default: {err}"),
    }
    prefs.autostart_default_applied = true;
    if let Ok(json) = serde_json::to_string_pretty(&prefs) {
        let _ = fs::write(path, json);
    }
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let launcher = app.autolaunch();
    if enabled {
        launcher.enable().map_err(|e| format!("couldn't turn on start with Windows: {e}"))?;
    } else {
        launcher.disable().map_err(|e| format!("couldn't turn off start with Windows: {e}"))?;
    }
    launcher.is_enabled().map_err(|e| e.to_string())
}
