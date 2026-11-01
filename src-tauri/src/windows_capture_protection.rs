//! Windows screen-capture exclusion for the Interview Mode overlay, the
//! floating bubble, and the main window.
//!
//! Uses the native `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` Win32
//! API (available since Windows 10 version 2004) to ask the OS compositor to
//! omit a window from screen captures, screen recordings, and most
//! screen-share pipelines (which typically capture via the same OS-level
//! APIs this affects — e.g. Desktop Duplication API / Windows.Graphics.Capture).
//!
//! IMPORTANT — this is not a guarantee. `SetWindowDisplayAffinity` affects
//! capture through the standard Windows compositor APIs. It does NOT protect
//! against:
//!   - A physical camera pointed at the screen.
//!   - Third-party/legacy capture methods that bypass DWM (rare in practice,
//!     but exist for the older `WDA_MONITOR` era of GPU/driver-level capture).
//!   - The window being visible in the *local* display at all — that's the
//!     point; only the *captured/shared* output excludes it.
//!
//! ## Design invariant
//!
//! This module treats capture exclusion strictly as a **window property**
//! (one flag DWM stores per HWND), never as a rendering mechanism. Earlier
//! revisions of this code tried to "nudge" DWM into recomputing a window's
//! composition via `SetWindowPos(..., SWP_FRAMECHANGED)` as a workaround for
//! a suspected stuck-compositor case. That call forces Windows to invalidate
//! and rebuild the window's composition surface — for a frameless,
//! transparent, WebView2-rendered, always-on-top window, that is a genuine
//! rendering operation, and it produced exactly the local black-rectangle
//! artifact it was trying to prevent (the freshly invalidated surface
//! briefly showing before WebView2 repaints into it). It has been removed.
//! [`reconcile`] below only ever calls `SetWindowDisplayAffinity`, which is
//! documented to affect capture routing metadata only — it does not resize,
//! move, repaint, or otherwise touch what the local user sees. Do not add
//! anything here that does.
//!
//! ## Single authoritative manager
//!
//! [`reconcile`] is the one function every window-lifecycle call site in
//! this codebase uses to apply capture exclusion — there is no lower-level
//! "just call SetWindowDisplayAffinity yourself" path left; everything goes
//! through here so the tracking below is never bypassed. It:
//! - Validates the HWND (`IsWindow`) before touching it, so a stale handle
//!   from before a window was recreated is never passed to a Win32 call.
//! - Tracks the last (HWND, desired-state) pair it successfully applied per
//!   window label, so re-reconciling an unchanged state is a true no-op —
//!   no repeated Win32 calls — while an HWND change (window recreated) or a
//!   state change (toggled) always gets a fresh apply.
//! - Logs every transition under the `[CaptureExclusion]` tag with the HWND,
//!   requested/applied state, and the Win32 result, so a real session's log
//!   file can show exactly what happened and when.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use tauri::WebviewWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowDisplayAffinity, IsWindow, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
};
use crate::crash_guard::LockExt;

/// Raw `WDA_EXCLUDEFROMCAPTURE` value, exposed for callers/logs that want to
/// compare against `get_capture_affinity`'s read-back without depending on
/// the `windows` crate's type directly.
pub const WDA_EXCLUDEFROMCAPTURE_VALUE: u32 = WDA_EXCLUDEFROMCAPTURE.0;

/// Reads back the *actual* display affinity Windows currently has recorded
/// for `window`, rather than trusting that a past `enable_capture_exclusion`
/// call is still in effect. Returns the raw `WDA_*` value (0 = `WDA_NONE`,
/// 0x11 = `WDA_EXCLUDEFROMCAPTURE`) so callers/logs can tell "the flag was
/// never dropped" apart from "the flag reverted".
/// Stable per-window identity for the watchdog's "window was recreated" check.
pub fn window_handle_value(window: &WebviewWindow) -> Option<isize> {
    window.hwnd().ok().map(|h| h.0 as isize)
}

pub fn get_capture_affinity(window: &WebviewWindow) -> Result<u32, String> {
    let hwnd = window.hwnd().map_err(|e| format!("failed to get window handle: {e}"))?;
    let mut affinity = 0u32;
    unsafe {
        GetWindowDisplayAffinity(hwnd, &mut affinity)
            .map_err(|e| format!("GetWindowDisplayAffinity failed: {e}"))?;
    }
    Ok(affinity)
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct AppliedState {
    hwnd: isize,
    excluded: bool,
}

fn registry() -> &'static Mutex<HashMap<String, AppliedState>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, AppliedState>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Pure decision logic, factored out of `reconcile` so it's unit-testable
/// without a real HWND: given what's cached for a label and what's now being
/// requested, decide whether a Win32 call is actually needed.
#[derive(Debug, PartialEq, Eq)]
enum ReconcileAction {
    /// Cached state already matches this exact HWND + desired state — skip
    /// the Win32 call entirely.
    Skip,
    /// HWND or desired state differs from what's cached (or nothing is
    /// cached yet) — apply and record the result.
    Apply,
}

/// `actual_excluded` is what Windows currently reports for the window via
/// `GetWindowDisplayAffinity`, or `None` when that read failed. It takes
/// precedence over `cached`: the flag can be dropped underneath an unchanged
/// HWND, and a cache entry saying "already applied" would then skip the very
/// Win32 call meant to repair it — which is how `close_overlay_window`'s
/// re-assert before showing the main window again silently became a no-op
/// (visible in logs as a `close_overlay_window` block with no accompanying
/// `[CaptureExclusion] label=main` line).
fn decide(
    cached: Option<AppliedState>,
    actual_excluded: Option<bool>,
    hwnd_value: isize,
    desired: bool,
) -> ReconcileAction {
    if actual_excluded.is_some_and(|actual| actual != desired) {
        return ReconcileAction::Apply;
    }
    match cached {
        Some(state) if state.hwnd == hwnd_value && state.excluded == desired => ReconcileAction::Skip,
        _ => ReconcileAction::Apply,
    }
}

/// The single authoritative entry point for capture exclusion. Every
/// window-lifecycle call site (show, reshow after being hidden, monitor/DPI
/// change, periodic safety-net check) should call this instead of reaching
/// for `enable_capture_exclusion`/`disable_capture_exclusion` directly.
///
/// `label` identifies the window for the idempotency cache (a window's
/// Tauri label is stable across hide/show and even across close+recreate,
/// which is exactly the case this needs to track: the *HWND* can change
/// under an unchanged label, and that must force a fresh apply rather than
/// being skipped as "already correct").
pub fn reconcile(window: &WebviewWindow, label: &str, desired: bool) {
    let hwnd = match window.hwnd() {
        Ok(h) => h,
        Err(err) => {
            log::warn!("[CaptureExclusion] label={label} hwnd=<unavailable> desired={desired} result=HWND_UNAVAILABLE error={err}");
            return;
        }
    };
    let hwnd_value = hwnd.0 as isize;

    // Validate the HWND is a live window before touching it at all — a
    // stale cached handle (e.g. the window was destroyed and a new one
    // built under the same label) must never reach a Win32 call.
    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        log::warn!(
            "[CaptureExclusion] label={label} hwnd={hwnd_value:#x} desired={desired} result=INVALID_HWND (stale handle, skipping)"
        );
        registry().lock_safe().remove(label);
        return;
    }

    // Ask Windows what the flag actually is right now rather than trusting
    // the cache — see `decide`. Note a window that isn't currently visible
    // reads back as `WDA_NONE` regardless of what was applied to it, so this
    // errs toward re-applying for hidden windows, which is harmless: it's a
    // pure window-property call with nothing to render.
    let actual_excluded = {
        let mut affinity = 0u32;
        let read = unsafe { GetWindowDisplayAffinity(hwnd, &mut affinity) };
        read.is_ok().then(|| affinity == WDA_EXCLUDEFROMCAPTURE.0)
    };

    let mut reg = registry().lock_safe();
    let cached = reg.get(label).copied();

    if decide(cached, actual_excluded, hwnd_value, desired) == ReconcileAction::Skip {
        // True no-op: no Win32 call, nothing logged beyond this — reconcile
        // is meant to be callable from any lifecycle event (resize, focus,
        // visibility change) without spamming the log or issuing redundant
        // syscalls when nothing has actually changed.
        return;
    }

    if let Some(prev) = cached {
        if prev.hwnd != hwnd_value {
            log::info!(
                "[CaptureExclusion] label={label} hwnd={hwnd_value:#x} — HWND changed since last apply (was {:#x}), reapplying",
                prev.hwnd
            );
        }
    }

    let result = unsafe {
        if desired {
            SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)
        } else {
            SetWindowDisplayAffinity(hwnd, WDA_NONE)
        }
    };

    match result {
        Ok(()) => {
            reg.insert(label.to_string(), AppliedState { hwnd: hwnd_value, excluded: desired });
            log::info!("[CaptureExclusion] label={label} hwnd={hwnd_value:#x} desired={desired} result=OK");
        }
        Err(err) => {
            // A failed call must not leave a stale "it worked" entry behind
            // — drop the cache entry so the next reconcile (watchdog tick or
            // the next lifecycle event) always retries rather than trusting
            // a state that was never actually achieved.
            reg.remove(label);
            log::warn!("[CaptureExclusion] label={label} hwnd={hwnd_value:#x} desired={desired} result=FAILED error={err}");
        }
    }
}

/// Releases the capture exclusion for a window that has just been hidden.
///
/// Hiding a window does **not** release the region DWM is holding for it. A
/// hidden window that still carries `WDA_EXCLUDEFROMCAPTURE` leaves a solid
/// black rectangle at its last on-screen bounds in any capture session that
/// was *already running* — a live "Entire Screen" share — because DWM keeps
/// carving that area out of the captured composition while no longer having
/// any window content there to composite behind it. The artifact therefore
/// appears only on hide (ending an interview), never while the window is
/// visible, and persists for as long as the share does.
///
/// Call this immediately *after* `hide()`, never before: once the window is
/// off-screen, dropping the flag cannot expose its contents to the capture,
/// whereas clearing it while still visible would leak a frame. Every show
/// path re-applies exclusion before the window becomes visible again (see
/// `overlay_window::show_overlay_window` and `bubble_window`), so this does
/// not weaken protection for the next session.
pub fn release_after_hide(window: &WebviewWindow, label: &str) {
    reconcile(window, label, false);
}

/// Drops any cached applied-state for `label` — call when a window is
/// permanently closed/destroyed (not just hidden) so a future window built
/// under the same label always gets a fresh `reconcile` apply rather than
/// possibly matching a stale cache entry by coincidence of HWND reuse.
/// No current call site in this codebase destroys these windows (every
/// lifecycle transition hides/shows the same long-lived HWND — see this
/// module's doc comment) — kept as part of the manager's public contract for
/// if/when a real destroy-and-rebuild recovery path is added, so that path
/// doesn't have to reach into this module's private registry.
#[allow(dead_code)]
pub fn forget(label: &str) {
    registry().lock_safe().remove(label);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_reconcile_for_a_label_always_applies() {
        assert_eq!(decide(None, Some(false), 0x1234, true), ReconcileAction::Apply);
    }

    #[test]
    fn matching_hwnd_and_state_is_skipped() {
        let cached = AppliedState { hwnd: 0x1234, excluded: true };
        assert_eq!(decide(Some(cached), Some(true), 0x1234, true), ReconcileAction::Skip);
    }

    #[test]
    fn changed_desired_state_forces_apply() {
        let cached = AppliedState { hwnd: 0x1234, excluded: true };
        assert_eq!(decide(Some(cached), Some(true), 0x1234, false), ReconcileAction::Apply);
    }

    #[test]
    fn changed_hwnd_forces_apply_even_if_desired_state_is_unchanged() {
        // The window was recreated (new HWND) under the same label — even
        // though the *desired* state is identical, the new HWND has never
        // actually had the flag applied to it, so this must not be skipped.
        let cached = AppliedState { hwnd: 0x1234, excluded: true };
        assert_eq!(decide(Some(cached), Some(true), 0x5678, true), ReconcileAction::Apply);
    }

    #[test]
    fn flag_dropped_underneath_an_unchanged_hwnd_forces_apply() {
        // The exact case that made `close_overlay_window`'s re-assert before
        // `main.show()` a silent no-op: the cache still says "applied", the
        // HWND hasn't changed, but Windows no longer has the flag set.
        let cached = AppliedState { hwnd: 0x1234, excluded: true };
        assert_eq!(decide(Some(cached), Some(false), 0x1234, true), ReconcileAction::Apply);
    }

    #[test]
    fn unreadable_affinity_falls_back_to_the_cache() {
        let cached = AppliedState { hwnd: 0x1234, excluded: true };
        assert_eq!(decide(Some(cached), None, 0x1234, true), ReconcileAction::Skip);
    }
}
