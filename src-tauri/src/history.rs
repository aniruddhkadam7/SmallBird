//! Interview history: a small on-disk archive of past Interview Mode
//! sessions, so the main window can list what happened in prior interviews.
//!
//! This is deliberately separate from `transcript::InterviewSession` (the raw
//! STT segments for the *current* recording) — history entries are the ASK AI
//! question/answer turns from the overlay, which is what a person actually
//! wants to review afterward, not the raw dictation feed.
//!
//! The one exception is a session that has *no* Ask AI turns at all (never
//! used, or the app died before the first answer finished): rather than
//! leaving a billed interview with nothing to show for it, the raw speech
//! journal (see `transcript::journal`) is turned into a history entry so a
//! transcript always exists. See `finalize_journals`.
//!
//! Durability rules, in order of importance:
//!   1. A transcript that reached disk is never lost to a *later* write — the
//!      history file is replaced atomically and the previous good copy is
//!      kept, and an unreadable file is set aside rather than overwritten.
//!   2. A transcript is never dropped from the server because an older
//!      upload landed after a newer one — uploads are serialised, always send
//!      the latest local copy, and only mark it synced if it didn't change
//!      while the request was in flight.
//!   3. A transcript that failed to upload is retried until it succeeds — in
//!      the background while the app runs, and again on the next launch.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::audio::AudioSource;
use crate::auth::client::{SUPABASE_ANON_KEY, SUPABASE_URL};
use crate::state::AppState;
use crate::transcript::journal::{self, JournalSegment, JournalWriter, LoadedJournal};
use crate::transcript::RecordingState;

/// Marks a turn built from raw speech rather than an Ask AI exchange. The
/// value rides inside the `turns` JSONB (no schema change needed) so any
/// reader can label it differently if it wants to.
pub const KIND_SPEECH: &str = "speech";

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
    /// `None` for an Ask AI exchange, `Some("speech")` for a turn rebuilt
    /// from the raw speech journal (question = what the interviewer said,
    /// answer = what the candidate said back).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
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
    /// upsert actually succeeds — never optimistically. Retried until it does
    /// (see `spawn_background_tasks`), which is how a transcript survives a
    /// network drop that happened mid-interview: the local copy is never in
    /// question (see `save`), only whether the website's copy caught up yet.
    #[serde(default)]
    pub synced: bool,
    /// Bumped on every local change. A sync only counts if the revision it
    /// uploaded is still the current one when the request finishes; otherwise
    /// the entry changed mid-flight and stays unsynced until the newer copy
    /// goes up.
    #[serde(default)]
    pub revision: u64,
}

pub struct HistoryStore(
    pub Mutex<Vec<InterviewHistoryEntry>>,
    /// Held for the whole of one upload so two uploads of the same entry can
    /// never race and land out of order.
    pub tokio::sync::Mutex<()>,
);

impl Default for HistoryStore {
    fn default() -> Self {
        Self(Mutex::new(Vec::new()), tokio::sync::Mutex::new(()))
    }
}

// ---------------------------------------------------------------------------
// Disk format: atomic writes, a backup, and never overwriting what we can't read
// ---------------------------------------------------------------------------

fn history_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("interview_history.json"))
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create app data directory: {e}"))?;
    Ok(dir)
}

fn journal_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("transcript_journal"))
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn parse_entries(path: &Path) -> Option<Vec<InterviewHistoryEntry>> {
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

/// Loads history from `path`. A missing file is just an empty history. A file
/// that exists but can't be parsed is *never* treated as empty — that used to
/// mean the next save silently overwrote every unsynced transcript on the
/// machine. Instead the damaged file is renamed aside for recovery and the
/// last good backup is used.
fn load_path(path: &Path) -> Vec<InterviewHistoryEntry> {
    if !path.exists() {
        // First run, or the primary went missing mid-rename: the backup, if
        // any, is the last good copy.
        return parse_entries(&backup_path(path)).unwrap_or_default();
    }
    if let Some(entries) = parse_entries(path) {
        return entries;
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let quarantined = path.with_extension(format!("json.corrupt-{stamp}"));
    match fs::rename(path, &quarantined) {
        Ok(()) => log::error!(
            "interview history was unreadable; kept it at {} and falling back to the last backup",
            quarantined.display()
        ),
        Err(err) => log::error!("interview history was unreadable and could not be set aside: {err}"),
    }
    parse_entries(&backup_path(path)).unwrap_or_default()
}

/// Writes `entries` so that at every instant the file on disk is either the
/// complete old version or the complete new one: serialise, write a temp file
/// beside it, force it to disk, then rename over the target. The previous
/// good version is kept as `.bak` first.
fn save_path(path: &Path, entries: &[InterviewHistoryEntry]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("failed to serialize interview history: {e}"))?;

    if path.exists() && parse_entries(path).is_some() {
        // Best effort: a failed backup must not block saving the new data.
        let _ = fs::copy(path, backup_path(path));
    }

    let tmp = path.with_extension("json.tmp");
    let mut file = fs::File::create(&tmp).map_err(|e| format!("failed to create temp history file: {e}"))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("failed to write interview history: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("failed to flush interview history: {e}"))?;
    drop(file);
    fs::rename(&tmp, path).map_err(|e| format!("failed to replace interview history: {e}"))
}

pub fn load(app: &AppHandle) -> Vec<InterviewHistoryEntry> {
    match history_file_path(app) {
        Ok(path) => load_path(&path),
        Err(err) => {
            log::warn!("interview history: {err}");
            Vec::new()
        }
    }
}

fn save(app: &AppHandle, entries: &[InterviewHistoryEntry]) -> Result<(), String> {
    save_path(&history_file_path(app)?, entries)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

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
/// Also mirrors the entry to Supabase (`interview_transcripts`) so the
/// website can show it. Sync runs in the background after the local
/// save/return: a slow or failed network call must never delay saving
/// locally (which always has to succeed) or surface as an error the user has
/// no way to act on. A failed sync leaves `synced: false` on the local
/// entry, which the background retry loop keeps trying — so a network
/// interruption during the interview delays the website copy, it never
/// loses it.
#[tauri::command]
pub async fn save_interview_session(
    app: AppHandle,
    store: tauri::State<'_, HistoryStore>,
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
        id: id.clone(),
        started_at_ms,
        ended_at_ms: now_ms(),
        role: role.filter(|s| !s.trim().is_empty()),
        company: company.filter(|s| !s.trim().is_empty()),
        turns,
        synced: false,
        revision: 0,
    };

    let saved = upsert_local(&app, &store, entry)?;
    spawn_sync(&app, saved.id.clone());
    Ok(Some(saved))
}

/// Retries the backend sync for every locally-saved entry not yet confirmed
/// synced. Also run automatically on a timer (see `spawn_background_tasks`);
/// kept as a command so the app can nudge it right after sign-in.
#[tauri::command]
pub async fn resync_pending_interview_transcripts(app: AppHandle) -> Result<(), String> {
    sync_all_pending(&app).await;
    Ok(())
}

/// Inserts or replaces the entry with the same id, bumping its revision, and
/// returns what was stored.
fn upsert_local(
    app: &AppHandle,
    store: &tauri::State<'_, HistoryStore>,
    entry: InterviewHistoryEntry,
) -> Result<InterviewHistoryEntry, String> {
    let mut guard = store.0.lock().unwrap();
    if guard.is_empty() {
        *guard = load(app);
    }
    let stored = apply_upsert(&mut guard, entry);
    save(app, &guard)?;
    Ok(stored)
}

fn apply_upsert(entries: &mut Vec<InterviewHistoryEntry>, mut entry: InterviewHistoryEntry) -> InterviewHistoryEntry {
    match entries.iter_mut().find(|e| e.id == entry.id) {
        Some(existing) => {
            entry.revision = existing.revision + 1;
            *existing = entry.clone();
        }
        None => {
            entry.revision = 1;
            entries.push(entry.clone());
        }
    }
    entry
}

// ---------------------------------------------------------------------------
// Sync to Supabase
// ---------------------------------------------------------------------------

/// Kicks off an upload without making the caller wait for it.
fn spawn_sync(app: &AppHandle, id: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = sync_one(&app, &id).await;
    });
}

/// Outcome of trying to upload one entry.
#[derive(Debug, PartialEq, Eq)]
enum SyncOutcome {
    /// Uploaded and confirmed (or already confirmed).
    Done,
    /// Not attempted: nobody is signed in, or the entry is gone.
    Skipped,
    /// Attempted and failed — worth retrying later, with backoff.
    Failed,
}

/// Uploads the *latest* local copy of `id`. Serialised behind a lock so two
/// uploads of one entry can't overlap, and the copy is re-read after the lock
/// is taken rather than trusting whatever snapshot the caller had: a queued
/// upload of turn 2 that only gets its turn after turn 3 was saved sends
/// turn 3, not the stale version.
async fn sync_one(app: &AppHandle, id: &str) -> SyncOutcome {
    let store = app.state::<HistoryStore>();
    let _upload_guard = store.1.lock().await;

    let snapshot = {
        let guard = store.0.lock().unwrap();
        match guard.iter().find(|e| e.id == id) {
            Some(e) if !e.synced => e.clone(),
            Some(_) => return SyncOutcome::Done,
            None => return SyncOutcome::Skipped,
        }
    };

    let state = app.state::<AppState>();
    let Ok(access_token) = crate::auth::current_access_token(&state).await else {
        return SyncOutcome::Skipped;
    };

    match sync_to_backend(&access_token, &snapshot).await {
        Ok(()) => {
            mark_synced(app, &snapshot.id, snapshot.revision);
            SyncOutcome::Done
        }
        Err(err) => {
            log::warn!("failed to sync interview transcript to backend: {err}");
            SyncOutcome::Failed
        }
    }
}

/// Tries every unsynced entry once; returns whether any attempt failed.
async fn sync_all_pending(app: &AppHandle) -> bool {
    let pending: Vec<String> = {
        let store = app.state::<HistoryStore>();
        let mut guard = store.0.lock().unwrap();
        if guard.is_empty() {
            *guard = load(app);
        }
        guard.iter().filter(|e| !e.synced).map(|e| e.id.clone()).collect()
    };
    let mut any_failed = false;
    for id in pending {
        if sync_one(app, &id).await == SyncOutcome::Failed {
            any_failed = true;
        }
    }
    any_failed
}

/// Marks an entry synced — but only if it is still the revision that was
/// uploaded. An entry edited while its upload was in flight stays unsynced so
/// the newer copy is sent next, instead of the server silently keeping the
/// older one forever.
fn mark_synced(app: &AppHandle, id: &str, uploaded_revision: u64) {
    let store = app.state::<HistoryStore>();
    let mut guard = store.0.lock().unwrap();
    if guard.is_empty() {
        *guard = load(app);
    }
    if !apply_synced(&mut guard, id, uploaded_revision) {
        return;
    }
    if let Err(err) = save(app, &guard) {
        log::warn!("failed to persist interview transcript sync state: {err}");
    }
}

/// Returns whether anything changed (and so needs saving).
fn apply_synced(entries: &mut [InterviewHistoryEntry], id: &str, uploaded_revision: u64) -> bool {
    match entries.iter_mut().find(|e| e.id == id) {
        Some(entry) if entry.revision == uploaded_revision && !entry.synced => {
            entry.synced = true;
            true
        }
        _ => false,
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

    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?
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

// ---------------------------------------------------------------------------
// Raw speech journal -> history entries
// ---------------------------------------------------------------------------

/// The journal of the recording in progress. One writer at a time, shared by
/// the STT event thread (every final segment) and the stop path (the last
/// half-spoken sentence).
static ACTIVE_JOURNAL: Mutex<Option<(String, JournalWriter)>> = Mutex::new(None);

/// Records one finalized piece of speech to disk. Never fails the caller: a
/// journal problem is logged and the live transcript carries on regardless.
pub fn journal_record(
    app: &AppHandle,
    session_id: &str,
    session_started_at_ms: u64,
    source: AudioSource,
    text: &str,
    at_ms: u64,
) {
    let mut slot = match ACTIVE_JOURNAL.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if slot.as_ref().map(|(id, _)| id.as_str()) != Some(session_id) {
        let opened = journal_dir(app).and_then(|dir| JournalWriter::open(&dir, session_id, session_started_at_ms));
        match opened {
            Ok(writer) => *slot = Some((session_id.to_string(), writer)),
            Err(err) => {
                log::warn!("transcript journal unavailable: {err}");
                *slot = None;
                return;
            }
        }
    }
    if let Some((_, writer)) = slot.as_mut() {
        if let Err(err) = writer.append(source, text, at_ms) {
            log::warn!("failed to journal transcript segment: {err}");
        }
    }
}

/// Speech from either side is grouped into question/answer-shaped turns so it
/// shows up in every existing transcript view unchanged. A new turn starts
/// after a long silence, or when a turn would otherwise grow unreadably big.
const TURN_GAP_MS: u64 = 20_000;
const TURN_MAX_CHARS: usize = 900;

/// Interviewer speech (system audio) becomes the "question", and the
/// candidate's reply (microphone) that follows becomes its "answer".
fn build_speech_turns(segments: &[JournalSegment]) -> Vec<HistoryTurn> {
    let mut turns: Vec<HistoryTurn> = Vec::new();
    let mut last_at: Option<u64> = None;
    // Whether the most recent turn is still open to receiving a reply.
    let mut answering = false;

    for seg in segments {
        let text = seg.text.trim();
        if text.is_empty() {
            continue;
        }
        let gap_exceeded = last_at.map(|t| seg.at_ms.saturating_sub(t) > TURN_GAP_MS).unwrap_or(false);
        last_at = Some(seg.at_ms);

        let start_new = |turns: &mut Vec<HistoryTurn>, question: &str, answer: &str| {
            turns.push(HistoryTurn {
                question: question.to_string(),
                answer: answer.to_string(),
                asked_at_ms: Some(seg.at_ms),
                kind: Some(KIND_SPEECH.to_string()),
            });
        };

        match seg.source {
            AudioSource::SystemAudio => {
                let too_long = turns
                    .last()
                    .map(|t| t.question.len() + text.len() > TURN_MAX_CHARS)
                    .unwrap_or(false);
                // Interviewer keeps talking into the same open question,
                // unless a reply has already started (then it's a new one).
                if turns.is_empty() || answering || gap_exceeded || too_long {
                    start_new(&mut turns, text, "");
                    answering = false;
                } else if let Some(t) = turns.last_mut() {
                    t.question.push(' ');
                    t.question.push_str(text);
                }
            }
            AudioSource::Microphone => {
                let too_long = turns
                    .last()
                    .map(|t| t.answer.len() + text.len() > TURN_MAX_CHARS)
                    .unwrap_or(false);
                if turns.is_empty() || gap_exceeded || too_long {
                    // A reply with no captured question before it (or after a
                    // long pause) still gets recorded, under an empty question.
                    start_new(&mut turns, "", text);
                } else if let Some(t) = turns.last_mut() {
                    if !t.answer.is_empty() {
                        t.answer.push(' ');
                    }
                    t.answer.push_str(text);
                }
                answering = true;
            }
        }
    }
    turns
}

/// A journal is "covered" when a real (Ask AI) history entry already spans the
/// same stretch of time — the transcript exists, this is just its raw feed.
fn is_covered(entries: &[InterviewHistoryEntry], start_ms: u64, end_ms: u64) -> bool {
    const SLACK_MS: u64 = 60_000;
    entries.iter().any(|e| {
        let is_ask_ai = e.turns.iter().any(|t| t.kind.as_deref() != Some(KIND_SPEECH));
        is_ask_ai
            && e.started_at_ms <= end_ms.saturating_add(SLACK_MS)
            && e.ended_at_ms.saturating_add(SLACK_MS) >= start_ms
    })
}

fn journal_bounds(j: &LoadedJournal) -> (u64, u64) {
    let start = j.header.started_at_ms;
    let end = j.segments.iter().map(|s| s.at_ms).max().unwrap_or(start).max(start);
    (start, end)
}

/// Builds a history entry from a finished journal and adds it to `entries` —
/// unless there's nothing worth keeping, it was already recovered (same
/// `entry_id`, so recovering twice can't duplicate), or a real Ask AI entry
/// already covers that interview. Returns the entry only when one was added.
fn recover_entry(entries: &mut Vec<InterviewHistoryEntry>, j: &LoadedJournal) -> Option<InterviewHistoryEntry> {
    let turns = build_speech_turns(&j.segments);
    if turns.is_empty() {
        return None;
    }
    let (start, end) = journal_bounds(j);
    if entries.iter().any(|e| e.id == j.header.entry_id) || is_covered(entries, start, end) {
        return None;
    }
    let entry = InterviewHistoryEntry {
        id: j.header.entry_id.clone(),
        started_at_ms: start,
        ended_at_ms: end,
        role: None,
        company: None,
        turns,
        synced: false,
        revision: 0,
    };
    Some(apply_upsert(entries, entry))
}

const RAW_KEEP_MS: u64 = 30 * 24 * 60 * 60 * 1000;

/// Turns every finished journal into a stored transcript (when nothing else
/// already covers it) and moves it to `done/`. `min_quiet_ms` is how long a
/// journal must have gone without a write to count as finished: 0 at app
/// startup (nothing can be recording yet, so every journal on disk belongs to
/// a session that already ended or crashed), a couple of minutes while
/// running so a live session — or one whose overlay is still saving its last
/// Ask AI turn — is left alone.
///
/// Returns the ids of entries newly created, so the caller can upload them.
fn finalize_journals(app: &AppHandle, min_quiet_ms: u64) -> Vec<String> {
    let Ok(dir) = journal_dir(app) else { return Vec::new() };
    let now = now_ms();

    // Never touch the journal of the recording that is running right now.
    let live_session: Option<String> = {
        let state = app.state::<AppState>();
        let recording = state
            .capture
            .lock()
            .map(|c| matches!(c.recording_state, RecordingState::Recording | RecordingState::Paused | RecordingState::Starting))
            .unwrap_or(false);
        if recording {
            state.transcript.lock().ok().map(|t| t.session().id.clone())
        } else {
            None
        }
    };

    let store = app.state::<HistoryStore>();
    let done_dir = dir.join("done");
    let mut created = Vec::new();

    for j in journal::list_journals(&dir) {
        if live_session.as_deref() == Some(j.header.session_id.as_str()) {
            continue;
        }
        if now.saturating_sub(j.last_write_ms) < min_quiet_ms {
            continue;
        }

        {
            let mut guard = store.0.lock().unwrap();
            if guard.is_empty() {
                *guard = load(app);
            }
            if let Some(stored) = recover_entry(&mut guard, &j) {
                if let Err(err) = save(app, &guard) {
                    // Leave the journal where it is: it will be retried, and
                    // is the only remaining copy.
                    log::warn!("could not store recovered transcript, keeping journal: {err}");
                    continue;
                }
                log::info!("recovered a transcript from the speech journal ({} turns)", stored.turns.len());
                created.push(stored.id);
            }
        }

        // Keep the raw feed (privately, on this machine) for a while rather
        // than deleting it — cheap insurance if anything above was wrong.
        if fs::create_dir_all(&done_dir).is_ok() {
            if let Some(name) = j.path.file_name() {
                let _ = fs::rename(&j.path, done_dir.join(name));
            }
        }
    }

    prune_done(&done_dir, now);
    created
}

fn prune_done(done_dir: &Path, now: u64) {
    let Ok(read_dir) = fs::read_dir(done_dir) else { return };
    for entry in read_dir.filter_map(|e| e.ok()) {
        let old = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| now.saturating_sub(d.as_millis() as u64) > RAW_KEEP_MS)
            .unwrap_or(false);
        if old {
            let _ = fs::remove_file(entry.path());
        }
    }
}

// ---------------------------------------------------------------------------
// Background worker
// ---------------------------------------------------------------------------

const RETRY_BASE_SECS: u64 = 30;
const RETRY_MAX_SECS: u64 = 300;
const JOURNAL_QUIET_MS: u64 = 2 * 60 * 1000;

/// Started once at launch. First recovers anything a previous run left behind
/// (a crash, a force-quit), then loops for the life of the app: turn finished
/// journals into transcripts, and keep retrying every transcript that hasn't
/// reached the server yet, backing off while the network or auth is down.
pub fn spawn_background_tasks(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        {
            let store = app.state::<HistoryStore>();
            let mut guard = store.0.lock().unwrap();
            if guard.is_empty() {
                *guard = load(&app);
            }
        }
        finalize_journals(&app, 0);

        let mut delay = RETRY_BASE_SECS;
        loop {
            let failed = sync_all_pending(&app).await;
            delay = if failed { (delay * 2).min(RETRY_MAX_SECS) } else { RETRY_BASE_SECS };
            tokio::time::sleep(Duration::from_secs(delay)).await;
            finalize_journals(&app, JOURNAL_QUIET_MS);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, start: u64, end: u64, kind: Option<&str>) -> InterviewHistoryEntry {
        InterviewHistoryEntry {
            id: id.into(),
            started_at_ms: start,
            ended_at_ms: end,
            role: None,
            company: None,
            turns: vec![HistoryTurn {
                question: "q".into(),
                answer: "a".into(),
                asked_at_ms: None,
                kind: kind.map(str::to_string),
            }],
            synced: false,
            revision: 0,
        }
    }

    fn seg(at: u64, source: AudioSource, text: &str) -> JournalSegment {
        JournalSegment { at_ms: at, source, text: text.into() }
    }

    fn tmp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sb-history-test-{tag}-{}", now_ms()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    // ----- disk format -----

    #[test]
    fn save_then_load_round_trips() {
        let path = tmp_dir("rt").join("h.json");
        save_path(&path, &[entry("a", 1, 2, None)]).unwrap();
        let loaded = load_path(&path);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "a");
        assert!(!path.with_extension("json.tmp").exists(), "temp file must be renamed away");
    }

    #[test]
    fn missing_file_is_an_empty_history() {
        assert!(load_path(&tmp_dir("missing").join("nope.json")).is_empty());
    }

    #[test]
    fn corrupt_file_falls_back_to_backup_and_is_kept_aside() {
        let path = tmp_dir("corrupt").join("h.json");
        save_path(&path, &[entry("old", 1, 2, None)]).unwrap();
        save_path(&path, &[entry("old", 1, 2, None), entry("new", 3, 4, None)]).unwrap();
        // Simulate the crash the old fs::write could cause: a truncated file.
        fs::write(&path, "[{\"id\":\"old\",\"started_a").unwrap();

        let loaded = load_path(&path);
        // The backup is the state before the last save.
        assert_eq!(loaded.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), vec!["old"]);
        assert!(!path.exists(), "the unreadable file must be moved aside, not left to be overwritten");
        let aside = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains(".corrupt-"));
        assert!(aside, "damaged file should be kept for manual recovery");
    }

    #[test]
    fn corrupt_file_with_no_backup_is_still_kept_not_destroyed() {
        let path = tmp_dir("nobak").join("h.json");
        fs::write(&path, "not json").unwrap();
        assert!(load_path(&path).is_empty());
        assert!(!path.exists());
    }

    #[test]
    fn old_entries_without_new_fields_still_load() {
        let path = tmp_dir("compat").join("h.json");
        fs::write(
            &path,
            r#"[{"id":"x","started_at_ms":1,"ended_at_ms":2,"turns":[{"question":"q","answer":"a"}]}]"#,
        )
        .unwrap();
        let loaded = load_path(&path);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].revision, 0);
        assert!(!loaded[0].synced);
        assert!(loaded[0].turns[0].kind.is_none());
    }

    #[test]
    fn kind_is_omitted_from_ask_ai_turns_when_serialised() {
        let v = serde_json::to_value(entry("a", 1, 2, None)).unwrap();
        assert!(v["turns"][0].get("kind").is_none());
        let v = serde_json::to_value(entry("a", 1, 2, Some("speech"))).unwrap();
        assert_eq!(v["turns"][0]["kind"], "speech");
    }

    // ----- revision-checked sync -----

    #[test]
    fn upsert_bumps_revision() {
        let mut list = Vec::new();
        assert_eq!(apply_upsert(&mut list, entry("a", 1, 2, None)).revision, 1);
        assert_eq!(apply_upsert(&mut list, entry("a", 1, 3, None)).revision, 2);
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn stale_upload_does_not_mark_a_newer_entry_synced() {
        let mut list = Vec::new();
        let v1 = apply_upsert(&mut list, entry("a", 1, 2, None)); // revision 1 goes out...
        apply_upsert(&mut list, entry("a", 1, 3, None)); // ...turn 2 saved meanwhile (revision 2)

        assert!(!apply_synced(&mut list, "a", v1.revision), "old upload must not count");
        assert!(!list[0].synced, "the newer copy still has to be uploaded");
    }

    #[test]
    fn matching_upload_marks_synced() {
        let mut list = Vec::new();
        let v = apply_upsert(&mut list, entry("a", 1, 2, None));
        assert!(apply_synced(&mut list, "a", v.revision));
        assert!(list[0].synced);
        assert!(!apply_synced(&mut list, "a", v.revision), "already synced: nothing to save");
    }

    #[test]
    fn a_new_local_change_clears_synced() {
        let mut list = Vec::new();
        let v = apply_upsert(&mut list, entry("a", 1, 2, None));
        apply_synced(&mut list, "a", v.revision);
        apply_upsert(&mut list, entry("a", 1, 3, None));
        assert!(!list[0].synced);
    }

    // ----- speech -> turns -----

    #[test]
    fn interviewer_then_candidate_becomes_one_question_answer_turn() {
        let turns = build_speech_turns(&[
            seg(1_000, AudioSource::SystemAudio, "Tell me about yourself."),
            seg(3_000, AudioSource::SystemAudio, "Start with your last role."),
            seg(6_000, AudioSource::Microphone, "I am an engineer."),
            seg(8_000, AudioSource::Microphone, "I build backends."),
        ]);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].question, "Tell me about yourself. Start with your last role.");
        assert_eq!(turns[0].answer, "I am an engineer. I build backends.");
        assert_eq!(turns[0].kind.as_deref(), Some(KIND_SPEECH));
        assert_eq!(turns[0].asked_at_ms, Some(1_000));
    }

    #[test]
    fn a_second_question_after_an_answer_starts_a_new_turn() {
        let turns = build_speech_turns(&[
            seg(1_000, AudioSource::SystemAudio, "First?"),
            seg(2_000, AudioSource::Microphone, "One."),
            seg(3_000, AudioSource::SystemAudio, "Second?"),
        ]);
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[1].question, "Second?");
        assert_eq!(turns[1].answer, "");
    }

    #[test]
    fn interviewer_only_sessions_still_produce_readable_turns() {
        // System-audio-only capture: no answers, just a long run of speech.
        let segs: Vec<_> = (0..10)
            .map(|i| seg(1_000 + i * 30_000, AudioSource::SystemAudio, "Some question here."))
            .collect();
        let turns = build_speech_turns(&segs);
        assert_eq!(turns.len(), 10, "each long silence starts a new turn");
    }

    #[test]
    fn nothing_is_dropped_when_a_reply_has_no_question() {
        let turns = build_speech_turns(&[seg(1_000, AudioSource::Microphone, "Hello?")]);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].question, "");
        assert_eq!(turns[0].answer, "Hello?");
    }

    #[test]
    fn oversized_turns_are_split_but_no_text_is_lost() {
        let word = "word ";
        let long = word.repeat(150); // ~750 chars per segment
        let segs = vec![
            seg(1_000, AudioSource::SystemAudio, &long),
            seg(2_000, AudioSource::SystemAudio, &long),
            seg(3_000, AudioSource::SystemAudio, &long),
        ];
        let turns = build_speech_turns(&segs);
        assert!(turns.len() >= 2);
        let total: usize = turns.iter().map(|t| t.question.split_whitespace().count()).sum();
        assert_eq!(total, 450);
    }

    #[test]
    fn blank_segments_produce_no_turns() {
        assert!(build_speech_turns(&[seg(1, AudioSource::SystemAudio, "   ")]).is_empty());
        assert!(build_speech_turns(&[]).is_empty());
    }

    // ----- coverage -----

    #[test]
    fn journal_covered_by_overlapping_ask_ai_entry() {
        let list = vec![entry("qa", 10_000, 500_000, None)];
        assert!(is_covered(&list, 12_000, 480_000));
    }

    #[test]
    fn journal_not_covered_by_a_different_interview() {
        let list = vec![entry("qa", 10_000, 20_000, None)];
        assert!(!is_covered(&list, 1_000_000, 2_000_000));
    }

    #[test]
    fn a_recovered_speech_entry_does_not_count_as_coverage() {
        // Otherwise a second journal in the same window could never recover.
        let list = vec![entry("sp", 10_000, 500_000, Some(KIND_SPEECH))];
        assert!(!is_covered(&list, 12_000, 480_000));
    }

    // ----- crash -> recovery, end to end on real files -----

    fn crashed_journal(dir: &Path, session: &str, start: u64, lines: &[(u64, AudioSource, &str)]) -> LoadedJournal {
        let mut w = JournalWriter::open(dir, session, start).unwrap();
        for (at, src, text) in lines {
            w.append(*src, text, *at).unwrap();
        }
        drop(w); // no clean shutdown: the process just "died"
        journal::list_journals(dir).into_iter().find(|j| j.header.session_id == session).unwrap()
    }

    #[test]
    fn a_session_with_no_ask_ai_turns_still_gets_a_transcript() {
        let dir = tmp_dir("recover");
        let j = crashed_journal(
            &dir,
            "s-1",
            1_000,
            &[
                (2_000, AudioSource::SystemAudio, "Why do you want this job?"),
                (5_000, AudioSource::Microphone, "Because of the problems you solve."),
            ],
        );
        let mut history = Vec::new();
        let stored = recover_entry(&mut history, &j).expect("transcript must be recovered");
        assert_eq!(stored.id, j.header.entry_id);
        assert_eq!(stored.turns.len(), 1);
        assert_eq!(stored.turns[0].question, "Why do you want this job?");
        assert!(!stored.synced, "recovered entries must still be uploaded");
        assert_eq!((stored.started_at_ms, stored.ended_at_ms), (1_000, 5_000));
    }

    #[test]
    fn recovering_the_same_journal_twice_never_duplicates() {
        let dir = tmp_dir("twice");
        let j = crashed_journal(&dir, "s-2", 1_000, &[(2_000, AudioSource::SystemAudio, "Hello there.")]);
        let mut history = Vec::new();
        assert!(recover_entry(&mut history, &j).is_some());
        assert!(recover_entry(&mut history, &j).is_none());
        assert_eq!(history.len(), 1);
    }

    #[test]
    fn a_normal_ask_ai_session_is_not_duplicated_by_its_journal() {
        let dir = tmp_dir("covered");
        let j = crashed_journal(&dir, "s-3", 1_000, &[(2_000, AudioSource::SystemAudio, "Question?")]);
        let mut history = vec![entry("qa", 900, 60_000, None)];
        assert!(recover_entry(&mut history, &j).is_none());
        assert_eq!(history.len(), 1);
    }

    #[test]
    fn a_journal_with_only_blank_speech_recovers_nothing() {
        let dir = tmp_dir("blank");
        let j = crashed_journal(&dir, "s-4", 1_000, &[(2_000, AudioSource::SystemAudio, "  ")]);
        assert!(recover_entry(&mut Vec::new(), &j).is_none());
    }

    #[test]
    fn recovered_entry_survives_a_save_and_reload() {
        let dir = tmp_dir("persist");
        let j = crashed_journal(&dir, "s-5", 1_000, &[(2_000, AudioSource::SystemAudio, "Persist me.")]);
        let mut history = Vec::new();
        recover_entry(&mut history, &j).unwrap();
        let path = dir.join("h.json");
        save_path(&path, &history).unwrap();
        let reloaded = load_path(&path);
        assert_eq!(reloaded[0].turns[0].question, "Persist me.");
        assert_eq!(reloaded[0].turns[0].kind.as_deref(), Some(KIND_SPEECH));
    }
}
