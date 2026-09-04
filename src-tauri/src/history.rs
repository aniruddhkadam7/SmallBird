//! Interview history: a small on-disk archive of past Interview Mode
//! sessions, so the main window can list what happened in prior interviews.
//!
//! This is deliberately separate from `transcript::InterviewSession` (the raw
//! STT segments for the *current* recording) — history entries are the ASK AI
//! question/answer turns from the overlay, which is what a person actually
//! wants to review afterward, not the raw dictation feed.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

use crate::auth::client::{SUPABASE_ANON_KEY, SUPABASE_URL};
use crate::state::AppState;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryTurn {
    pub question: String,
    pub answer: String,
    /// When this question was asked, as `Date.now()` in the overlay —
    /// `None` for entries archived before this field existed. Local-only,
    /// shown as a per-message timestamp in the History transcript view.
    #[serde(default)]
    pub asked_at_ms: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InterviewHistoryEntry {
    pub id: String,
    pub started_at_ms: u64,
    pub ended_at_ms: u64,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub company: Option<String>,
    pub turns: Vec<HistoryTurn>,
}

#[derive(Default)]
pub struct HistoryStore(pub Mutex<Vec<InterviewHistoryEntry>>);

fn history_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create app data directory: {e}"))?;
    Ok(dir.join("interview_history.json"))
}

pub fn load(app: &AppHandle) -> Vec<InterviewHistoryEntry> {
    let path = match history_file_path(app) {
        Ok(p) => p,
        Err(err) => {
            log::warn!("interview history: {err}");
            return Vec::new();
        }
    };
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save(app: &AppHandle, entries: &[InterviewHistoryEntry]) -> Result<(), String> {
    let path = history_file_path(app)?;
    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("failed to serialize interview history: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("failed to write interview history: {e}"))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("hist-{:x}-{:x}", now_ms(), n)
}

#[tauri::command]
pub fn list_interview_history(
    app: AppHandle,
    store: tauri::State<'_, HistoryStore>,
) -> Vec<InterviewHistoryEntry> {
    let mut guard = store.0.lock().unwrap();
    if guard.is_empty() {
        *guard = load(&app);
    }
    let mut entries = guard.clone();
    entries.sort_by(|a, b| b.started_at_ms.cmp(&a.started_at_ms));
    entries
}

/// Archives one finished Interview Mode session. Called only when the user
/// closes the overlay and confirms the interview is over — an empty `turns`
/// list (nothing was ever asked) is skipped so idle opens don't clutter
/// history.
///
/// Also best-effort mirrors the entry to Supabase (`interview_transcripts`)
/// so the website can show it — this only ever happens going forward from
/// when this shipped, never backfilling whatever's already sitting in the
/// local JSON file from before. Sync runs in the background after the local
/// save/return, on its own tokio task: a slow or failed network call must
/// never delay archiving locally (which always has to succeed, session or
/// no) or surface as an error the user has no way to act on.
#[tauri::command]
pub async fn archive_interview_session(
    app: AppHandle,
    store: tauri::State<'_, HistoryStore>,
    state: State<'_, AppState>,
    started_at_ms: u64,
    role: Option<String>,
    company: Option<String>,
    turns: Vec<HistoryTurn>,
) -> Result<Option<InterviewHistoryEntry>, String> {
    if turns.is_empty() {
        return Ok(None);
    }
    let entry = InterviewHistoryEntry {
        id: new_id(),
        started_at_ms,
        ended_at_ms: now_ms(),
        role: role.filter(|s| !s.trim().is_empty()),
        company: company.filter(|s| !s.trim().is_empty()),
        turns,
    };

    {
        let mut guard = store.0.lock().unwrap();
        if guard.is_empty() {
            *guard = load(&app);
        }
        guard.push(entry.clone());
        save(&app, &guard)?;
    }

    if let Ok(access_token) = crate::auth::current_access_token(&state).await {
        let entry_for_sync = entry.clone();
        tokio::spawn(async move {
            if let Err(err) = sync_to_backend(&access_token, &entry_for_sync).await {
                log::warn!("failed to sync interview transcript to backend: {err}");
            }
        });
    }

    Ok(Some(entry))
}

/// Mirrors one history entry into `public.interview_transcripts` via
/// PostgREST directly (same pattern as `auth::client::get_entitlement` —
/// no dedicated Edge Function needed for a plain authenticated insert).
/// `user_id` is never sent explicitly: the column defaults to `auth.uid()`
/// in the migration, derived from the same verified JWT this bearer token
/// carries, so there's no client-suppliable field an attacker could use to
/// write into someone else's row.
async fn sync_to_backend(access_token: &str, entry: &InterviewHistoryEntry) -> Result<(), String> {
    let body = serde_json::json!({
        "started_at_ms": entry.started_at_ms,
        "ended_at_ms": entry.ended_at_ms,
        "role": entry.role,
        "company": entry.company,
        "turns": entry.turns,
    });

    let response = reqwest::Client::new()
        .post(format!("{SUPABASE_URL}/rest/v1/interview_transcripts"))
        .header("apikey", SUPABASE_ANON_KEY)
        .bearer_auth(access_token)
        .header("Prefer", "return=minimal")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("{status}: {text}"));
    }
    Ok(())
}

#[tauri::command]
pub fn delete_interview_history_entry(
    app: AppHandle,
    store: tauri::State<'_, HistoryStore>,
    id: String,
) -> Result<(), String> {
    let mut guard = store.0.lock().unwrap();
    if guard.is_empty() {
        *guard = load(&app);
    }
    guard.retain(|e| e.id != id);
    save(&app, &guard)
}
