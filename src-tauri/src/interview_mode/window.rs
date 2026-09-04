//! Interview Mode's overlay window — thin wrapper over the shared
//! `overlay_window` module with Interview Mode's own window label/title
//! baked in.

use tauri::AppHandle;

use crate::overlay_window;

pub use overlay_window::OverlayCaptureStatus;

pub const OVERLAY_WINDOW_LABEL: &str = "interview-overlay";
const OVERLAY_TITLE: &str = "Smallbird Interview — Overlay";

pub fn show_overlay_window(app: &AppHandle) -> Result<OverlayCaptureStatus, String> {
    overlay_window::show_overlay_window(app, OVERLAY_WINDOW_LABEL, OVERLAY_TITLE)
}

pub fn close_overlay_window(app: &AppHandle) -> Result<(), String> {
    overlay_window::close_overlay_window(app, OVERLAY_WINDOW_LABEL)
}

pub fn toggle_overlay_window(app: &AppHandle) -> Result<OverlayCaptureStatus, String> {
    overlay_window::toggle_overlay_window(app, OVERLAY_WINDOW_LABEL, OVERLAY_TITLE)
}

pub fn set_overlay_always_on_top(app: &AppHandle, enabled: bool) -> Result<(), String> {
    overlay_window::set_overlay_always_on_top(app, OVERLAY_WINDOW_LABEL, enabled)
}

pub fn set_overlay_capture_exclusion(app: &AppHandle, enabled: bool) -> Result<OverlayCaptureStatus, String> {
    overlay_window::set_overlay_capture_exclusion(app, OVERLAY_WINDOW_LABEL, enabled)
}

pub fn resize_overlay(app: &AppHandle, fraction: f64) -> Result<(), String> {
    overlay_window::resize_overlay(app, OVERLAY_WINDOW_LABEL, fraction)
}

pub fn is_capture_excluded(app: &AppHandle) -> bool {
    overlay_window::is_capture_excluded(app, OVERLAY_WINDOW_LABEL)
}
