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
    /// Whether this entry has been confirmed written to
    /// `public.interview_transcripts`. Starts `false` on every local save and
    /// only ever flips to `true` from inside `mark_synced`, once the backend
    /// upsert actually succeeds — never optimistically. `resync_pending_
    /// interview_transcripts` retries every entry still `false`, which is how
    /// a transcript survives a network drop that happened mid-interview: the
    /// local copy is never in question (see `save`), only whether the
    /// website's copy caught up yet.
    #[serde(default)]
    pub synced: bool,
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

/// Saves the current state of one Interview Mode session — called
/// repeatedly during a session (once after every completed Ask AI turn, see
/// `InterviewOverlay.tsx`) and once more when the overlay closes, always
/// with the same client-generated `id` so every call after the first is an
/// upsert rather than a new entry. This is what makes a transcript durable
/// against a crash, a force-quit, or an app restart mid-interview: nothing
/// waits until the session "ends" to be written, because plenty of sessions
/// never end cleanly. An empty `turns` list (nothing completed yet) is
/// skipped so idle opens don't clutter history.
///
/// Also best-effort mirrors the entry to Supabase (`interview_transcripts`)
/// so the website can show it. Sync runs in the background after the local
/// save/return, on its own tokio task: a slow or failed network call must
/// never delay saving locally (which always has to succeed) or surface as
/// an error the user has no way to act on. A failed sync leaves `synced:
/// false` on the local entry, which `resync_pending_interview_transcripts`
/// retries later (e.g. on the next app start) — so a network interruption
/// during the interview delays the website copy, it never loses it.
#[tauri::command]
pub async fn save_interview_session(
    app: AppHandle,
    store: tauri::State<'_, HistoryStore>,
    state: State<'_, AppState>,
    id: String,
    started_at_ms: u64,
    role: Option<String>,
    company: Option<String>,
    turns: Vec<HistoryTurn>,
) -> Result<Option<InterviewHistoryEntry>, String> {
    if turns.is_empty() {
        return Ok(None);
    }
    let entry = InterviewHistoryEntry {
        id,
        started_at_ms,
        ended_at_ms: now_ms(),
        role: role.filter(|s| !s.trim().is_empty()),
        company: company.filter(|s| !s.trim().is_empty()),
        turns,
        synced: false,
    };

    upsert_local(&app, &store, entry.clone())?;
    spawn_sync(&app, &state, entry.clone()).await;
    Ok(Some(entry))
}

/// Retries the backend sync for every locally-saved entry not yet confirmed
/// synced. Called on app startup so an entry that only made it to the local
/// JSON file (interview ended while offline, or mid-sync when the app was
/// killed) still reaches the dashboard once connectivity/auth is back,
/// without the user having to do anything.
#[tauri::command]
pub async fn resync_pending_interview_transcripts(
    app: AppHandle,
    store: tauri::State<'_, HistoryStore>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let pending: Vec<InterviewHistoryEntry> = {
        let mut guard = store.0.lock().unwrap();
        if guard.is_empty() {
            *guard = load(&app);
        }
        guard.iter().filter(|e| !e.synced).cloned().collect()
    };
    for entry in pending {
        spawn_sync(&app, &state, entry).await;
    }
    Ok(())
}

fn upsert_local(
    app: &AppHandle,
    store: &tauri::State<'_, HistoryStore>,
    entry: InterviewHistoryEntry,
) -> Result<(), String> {
    let mut guard = store.0.lock().unwrap();
    if guard.is_empty() {
        *guard = load(app);
    }
    match guard.iter_mut().find(|e| e.id == entry.id) {
        Some(existing) => *existing = entry,
        None => guard.push(entry),
    }
    save(app, &guard)
}

async fn spawn_sync(app: &AppHandle, state: &State<'_, AppState>, entry: InterviewHistoryEntry) {
    if let Ok(access_token) = crate::auth::current_access_token(state).await {
        let app = app.clone();
        tokio::spawn(async move {
            match sync_to_backend(&access_token, &entry).await {
                Ok(()) => mark_synced(&app, &entry.id),
                Err(err) => log::warn!("failed to sync interview transcript to backend: {err}"),
            }
        });
    }
}

fn mark_synced(app: &AppHandle, id: &str) {
    let store = app.state::<HistoryStore>();
    let mut guard = store.0.lock().unwrap();
    if guard.is_empty() {
        *guard = load(app);
    }
    if let Some(entry) = guard.iter_mut().find(|e| e.id == id) {
        entry.synced = true;
    }
    if let Err(err) = save(app, &guard) {
        log::warn!("failed to persist interview transcript sync state: {err}");
    }
}

/// Upserts one history entry into `public.interview_transcripts` via
/// PostgREST directly (same pattern as `auth::client::get_entitlement` —
/// no dedicated Edge Function needed). `Prefer: resolution=merge-duplicates`
/// makes this an `insert ... on conflict (id) do update` against the
/// primary key, which is what lets the same session be synced repeatedly
/// (once per completed turn) instead of only once at the end. `user_id` is
/// never sent explicitly: the column defaults to `auth.uid()` in the
/// migration, derived from the same verified JWT this bearer token carries,
/// so there's no client-suppliable field an attacker could use to write
/// into or reassign someone else's row.
async fn sync_to_backend(access_token: &str, entry: &InterviewHistoryEntry) -> Result<(), String> {
    let body = serde_json::json!({
        "id": entry.id,
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
        .header("Prefer", "resolution=merge-duplicates,return=minimal")
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
