//! Crash resilience: keeps one bad input or one bug from taking the whole
//! app down mid-interview.
//!
//! - [`install_panic_hook`] records every panic (message, location, thread,
//!   backtrace) to the log *and* to a standalone `crash.log`, so a crash in a
//!   packaged build — which has no console — is diagnosable after the fact.
//!   It is installed before anything else runs, including the log plugin,
//!   which is why it doesn't rely on `log` alone.
//! - [`LockExt::lock_safe`] replaces `lock().unwrap()` /
//!   `lock().map_err(..)?`. A std `Mutex` is "poisoned" forever once any
//!   thread panics while holding it, after which every later `unwrap()`
//!   panics too (and inside a sync Tauri command, on the main thread, that
//!   aborts the process) and every `map_err` returns a useless
//!   "PoisonError" to the UI until restart. The guarded data here is plain
//!   state (transcript, settings, documents) that is still usable, so
//!   recovering is strictly better than cascading.
//! - [`guard`] runs panic-prone work (third-party parsers fed user files)
//!   and turns a panic into an ordinary `Err`, so the caller's command still
//!   resolves instead of leaving the frontend's `invoke` hanging forever.
//! - [`show_fatal_error`] tells the user *why* the app couldn't start rather
//!   than the process silently vanishing.

use std::any::Any;
use std::cell::Cell;
use std::io::Write;
use std::panic::{self, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

/// Matches `identifier` in tauri.conf.json — Tauri's LogDir on Windows is
/// `%LOCALAPPDATA%\<identifier>\logs` (`~/Library/Logs/<identifier>` on
/// macOS), and crash.log sits beside the regular log so both are found in one
/// place.
pub const APP_IDENTIFIER: &str = "com.smallbird.app";

thread_local! {
    /// Set while inside [`guard`], so the hook knows the panic is about to be
    /// caught and handled (log it, but don't treat it as fatal).
    static IN_GUARD: Cell<bool> = const { Cell::new(false) };
}

pub trait LockExt<T: ?Sized> {
    /// Locks, recovering the data if a previous holder panicked. See module docs.
    fn lock_safe(&self) -> MutexGuard<'_, T>;
}

impl<T: ?Sized> LockExt<T> for Mutex<T> {
    fn lock_safe(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(|poisoned| {
            log::warn!("recovered a poisoned lock (an earlier panic happened while it was held)");
            self.clear_poison();
            poisoned.into_inner()
        })
    }
}

#[cfg(windows)]
pub fn crash_log_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(PathBuf::from(base).join(APP_IDENTIFIER).join("logs").join("crash.log"))
}

#[cfg(target_os = "macos")]
pub fn crash_log_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join("Library/Logs").join(APP_IDENTIFIER).join("crash.log"))
}

fn append_crash_log(entry: &str) {
    let Some(path) = crash_log_path() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    // Keep the file from growing without bound over months of use.
    if std::fs::metadata(&path).map(|m| m.len() > 1024 * 1024).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{entry}\n");
    }
}

pub fn panic_message(payload: &(dyn Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic".to_string()
    }
}

pub fn install_panic_hook() {
    let previous = panic::take_hook();
    panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("<unnamed>").to_string();
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let message = panic_message(info.payload());
        let guarded = IN_GUARD.with(|g| g.get());
        let backtrace = std::backtrace::Backtrace::force_capture();
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        log::error!("panic on thread '{thread_name}' at {location}: {message}{}", if guarded { " (caught)" } else { "" });
        append_crash_log(&format!(
            "[unix {secs}] v{} panic on thread '{thread_name}' at {location}{}: {message}\n{backtrace}",
            env!("CARGO_PKG_VERSION"),
            if guarded { " (caught)" } else { "" },
        ));

        // A panic on the main (UI/event-loop) thread unwinds through the
        // windowing system's FFI callbacks, which aborts the process — tell
        // the user what happened instead of the window just vanishing.
        if thread_name == "main" && !guarded {
            show_fatal_error(
                "Smallbird ran into an unexpected problem and needs to close.\n\n\
                 Your transcript is saved and will be recovered the next time you open Smallbird.",
            );
        }

        previous(info);
    }));
}

/// Runs `f`, converting a panic into `Err("<what> failed unexpectedly")`.
/// Use for work driven by untrusted input where a third-party crate might
/// panic (malformed PDFs, odd DOCX archives).
pub fn guard<T>(what: &str, f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let was_guarded = IN_GUARD.with(|g| g.replace(true));
    let result = panic::catch_unwind(AssertUnwindSafe(f));
    IN_GUARD.with(|g| g.set(was_guarded));
    result.unwrap_or_else(|payload| {
        log::error!("{what} panicked: {}", panic_message(payload.as_ref()));
        Err(format!("{what} failed unexpectedly"))
    })
}

/// Lets the webviews record uncaught JS errors / React render crashes in the
/// same log file as the Rust side (a release build has no devtools console
/// to find them in otherwise). Truncated so a runaway error loop can't flood
/// the log with huge payloads.
#[tauri::command]
pub fn log_frontend_error(window: tauri::WebviewWindow, message: String) {
    let message: String = message.chars().take(4000).collect();
    log::error!("[frontend:{}] {message}", window.label());
}

/// Blocking native error dialog — usable even when no webview exists (e.g.
/// startup failed because the WebView2 runtime is missing).
pub fn show_fatal_error(message: &str) {
    #[cfg(windows)]
    {
        use windows::core::HSTRING;
        use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND};
        let text = match crash_log_path() {
            Some(path) => format!("{message}\n\nDetails: {}", path.display()),
            None => message.to_string(),
        };
        unsafe {
            MessageBoxW(None, &HSTRING::from(text), &HSTRING::from("Smallbird"), MB_OK | MB_ICONERROR | MB_SETFOREGROUND);
        }
    }
    #[cfg(not(windows))]
    eprintln!("{message}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_safe_recovers_poisoned_mutex() {
        let m = std::sync::Arc::new(Mutex::new(5));
        let m2 = m.clone();
        let _ = std::thread::spawn(move || {
            let _g = m2.lock().unwrap();
            panic!("boom");
        })
        .join();
        assert!(m.is_poisoned());
        *m.lock_safe() += 1;
        assert_eq!(*m.lock_safe(), 6);
        assert!(!m.is_poisoned());
    }

    #[test]
    fn guard_turns_panic_into_err() {
        let r: Result<(), String> = guard("parsing", || panic!("bad input"));
        assert_eq!(r.unwrap_err(), "parsing failed unexpectedly");
        assert_eq!(guard("x", || Ok(3)).unwrap(), 3);
    }
}
