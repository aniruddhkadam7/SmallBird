//! Keeps the two latency-critical backend functions warm, so pressing Start
//! or the overlay shortcut doesn't pay a Supabase edge-function cold start.
//!
//! Measured (Sept 2026): a cold `stt-token` call — the one that mints the
//! session's speech-to-text key, and that every session start waits on —
//! took 7.6s vs 1.8s warm; the ~6s difference is the function booting
//! (loading supabase-js) after sitting idle. `llm-proxy-v2` has the same
//! boot cost on the first answer.
//!
//! The warm-up is a CORS preflight (OPTIONS): it boots the function's worker
//! (confirmed in the function logs, ~140ms each) but never reaches any
//! handler logic — no auth, no session row, no key minted, nothing metered,
//! no audio. Sent shortly after launch, every few minutes while the app
//! runs, and when the main window is focused (throttled).

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SUPABASE_URL: &str = "https://xubbwgrjvvsbfvxcuzav.supabase.co";
const WARM_FUNCTIONS: [&str; 2] = ["stt-token", "llm-proxy-v2"];
/// Edge workers are recycled after a few idle minutes; this stays inside that.
const KEEP_WARM_EVERY: Duration = Duration::from_secs(180);
/// Focus-triggered warm-ups are skipped if one ran this recently.
const MIN_GAP_SECS: u64 = 60;

static LAST_WARM_SECS: AtomicU64 = AtomicU64::new(0);

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn ping_all() {
    LAST_WARM_SECS.store(now_secs(), Ordering::Relaxed);
    let Ok(client) = reqwest::blocking::Client::builder().timeout(Duration::from_secs(10)).build() else {
        return;
    };
    for function in WARM_FUNCTIONS {
        let result = client
            .request(reqwest::Method::OPTIONS, format!("{SUPABASE_URL}/functions/v1/{function}"))
            .header("Origin", "https://smallbird.in")
            .header("Access-Control-Request-Method", "POST")
            .send();
        if let Err(err) = result {
            log::debug!("backend warm-up of {function} failed (harmless): {err}");
        }
    }
}

/// Warm-up shortly after launch, then every `KEEP_WARM_EVERY`, on a plain
/// background thread for the life of the process.
pub fn spawn_keep_warm() {
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(3));
        loop {
            ping_all();
            std::thread::sleep(KEEP_WARM_EVERY);
        }
    });
}

/// The main window calls this when it's focused — a strong sign a session
/// may start soon. Throttled; never blocks the caller.
#[tauri::command]
pub fn warm_backend() {
    if now_secs().saturating_sub(LAST_WARM_SECS.load(Ordering::Relaxed)) < MIN_GAP_SECS {
        return;
    }
    std::thread::spawn(ping_all);
}
