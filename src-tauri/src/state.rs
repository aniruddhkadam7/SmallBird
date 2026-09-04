use std::collections::HashMap;
use std::sync::Mutex;
use std::thread::JoinHandle;

use crate::audio::{PauseSignal, StopSignal};
use crate::auth::AuthSession;
use crate::documents::DocumentRecord;
use crate::stt::SttSession;
use crate::transcript::{RecordingState, TranscriptManager};

/// Handles for an in-progress recording session, held so Tauri commands can stop it
/// later. Wrapped in `Mutex` because Tauri commands run on arbitrary threads from
/// the async runtime.
pub struct CaptureSession {
    pub stop_signal: Option<StopSignal>,
    pub pause_signal: Option<PauseSignal>,
    pub system_audio_thread: Option<JoinHandle<()>>,
    pub pipeline_thread: Option<JoinHandle<()>>,
    pub recording_state: RecordingState,
}

impl Default for CaptureSession {
    fn default() -> Self {
        Self {
            stop_signal: None,
            pause_signal: None,
            system_audio_thread: None,
            pipeline_thread: None,
            recording_state: RecordingState::Idle,
        }
    }
}

#[derive(Default)]
pub struct AppState {
    pub capture: Mutex<CaptureSession>,
    pub transcript: Mutex<TranscriptManager>,
    /// Uploaded resume/CV, job-description, and additional-context documents
    /// — keyed by document id, extracted in-process (see `documents.rs`).
    /// In-memory only, cleared on app restart.
    pub documents: Mutex<HashMap<String, DocumentRecord>>,
    /// The signed-in Supabase session, if any. `None` means logged out — the
    /// app requires login for every AI feature (no BYOK fallback). Refreshed
    /// transparently by `auth::current_access_token` when near expiry.
    pub auth_session: Mutex<Option<AuthSession>>,
    /// Set by `interview_mode::commands::start_backend_session` (mints a
    /// scoped Deepgram key + starts an `interview_sessions` row), read by
    /// `commands::start_capture_inner` to get the key `SttClient::spawn`
    /// needs, cleared by `end_backend_session` (reports usage, stops the
    /// heartbeat loop).
    pub stt_session: Mutex<Option<SttSession>>,
}
