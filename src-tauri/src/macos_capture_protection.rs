//! macOS screen-capture exclusion for the Interview Mode overlay, the
//! floating bubble, and the main window — the counterpart of
//! `windows_capture_protection.rs`, mounted under the same module name (see
//! `lib.rs`) so every call site stays platform-neutral.
//!
//! Uses Tauri's `set_content_protected`, which sets the NSWindow's
//! `sharingType` to `NSWindowSharingNone` (protected) or back to
//! `NSWindowSharingReadOnly`. Like the Windows flag this is a pure window
//! property: it never moves, resizes, or repaints what the local user sees.
//!
//! IMPORTANT — this is not a guarantee. Apps that capture through
//! ScreenCaptureKit on newer macOS releases may still include the window;
//! test each release against the real share paths (Zoom, Meet in Chrome,
//! Teams) on the macOS versions users run.
//!
//! macOS has no `GetWindowDisplayAffinity` equivalent that is safe to call
//! off the main thread, so the read-back reports the state last applied
//! here. Unlike DWM, AppKit doesn't drop `sharingType` behind the app's
//! back, so the cache is authoritative in practice.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use tauri::WebviewWindow;
use crate::crash_guard::LockExt;

/// Same value the Windows module reports for an excluded window, so the
/// overlay watchdog's comparisons work unchanged.
pub const WDA_EXCLUDEFROMCAPTURE_VALUE: u32 = 0x11;
const WDA_NONE_VALUE: u32 = 0;

fn registry() -> &'static Mutex<HashMap<String, bool>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Stable per-window identity for the watchdog's "window was recreated" check
/// (the HWND on Windows, the NSWindow pointer here).
pub fn window_handle_value(window: &WebviewWindow) -> Option<isize> {
    window.ns_window().ok().map(|ptr| ptr as isize)
}

pub fn get_capture_affinity(window: &WebviewWindow) -> Result<u32, String> {
    let excluded = registry().lock_safe().get(window.label()).copied().unwrap_or(false);
    Ok(if excluded { WDA_EXCLUDEFROMCAPTURE_VALUE } else { WDA_NONE_VALUE })
}

/// The single authoritative entry point for capture exclusion — see the
/// Windows module's doc comment for the contract every call site relies on.
pub fn reconcile(window: &WebviewWindow, label: &str, desired: bool) {
    let mut reg = registry().lock_safe();
    if reg.get(label) == Some(&desired) {
        return;
    }
    match window.set_content_protected(desired) {
        Ok(()) => {
            reg.insert(label.to_string(), desired);
            log::info!("[CaptureExclusion] label={label} desired={desired} result=OK");
        }
        Err(err) => {
            reg.remove(label);
            log::warn!("[CaptureExclusion] label={label} desired={desired} result=FAILED error={err}");
        }
    }
}

/// Kept for parity with Windows, where a hidden-but-excluded window leaves a
/// black box in a running share. Harmless here: every show path re-applies
/// exclusion before the window becomes visible again.
pub fn release_after_hide(window: &WebviewWindow, label: &str) {
    reconcile(window, label, false);
}

#[allow(dead_code)]
pub fn forget(label: &str) {
    registry().lock_safe().remove(label);
}
