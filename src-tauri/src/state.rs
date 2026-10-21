use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::thread::JoinHandle;

use crate::audio::{PauseSignal, StopSignal};
use crate::auth::AuthSession;
use crate::backend::ConversationStateSnapshot;
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
    /// The user's own microphone, when they've turned the overlay's Mic on
    /// (see `commands::set_microphone_enabled`). Off by default.
    pub mic: Option<MicSession>,
}

/// A running microphone capture + its own Deepgram connection. Shares the
/// session's key and pause signal; has its own stop signal so the Mic can be
/// turned off without ending the session.
pub struct MicSession {
    pub stop: StopSignal,
    pub capture_thread: JoinHandle<()>,
    pub pipeline_thread: JoinHandle<()>,
}

/// System audio being recorded from the moment the user pressed Start/the
/// shortcut, before the session's speech-to-text key and connection are
/// ready (see `commands::begin_audio_prebuffer`). Chunks queue in
/// `audio_rx`; the STT pipeline takes this over once connected and sends
/// the backlog first, so nothing said after the press is lost.
pub struct AudioPrebuffer {
    pub id: u64,
    /// The call audio — absent when it's off for this session (Assistant
    /// Mode's default).
    pub system: Option<CaptureBuffer>,
    /// The user's microphone, recording alongside when their Mic is on.
    pub mic: Option<CaptureBuffer>,
}

/// Audio (either source) being recorded before its speech-to-text
/// connection is up — from the key press, or from the moment the user turns
/// the source on — so nothing said while it connects is lost.
pub struct CaptureBuffer {
    pub audio_rx: crossbeam_channel::Receiver<crate::audio::AudioChunk>,
    pub stop: StopSignal,
    pub thread: JoinHandle<()>,
}

impl Default for CaptureSession {
    fn default() -> Self {
        Self {
            stop_signal: None,
            pause_signal: None,
            system_audio_thread: None,
            pipeline_thread: None,
            recording_state: RecordingState::Idle,
            mic: None,
        }
    }
}

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
    /// Whether the Interview Mode overlay *should* currently be excluded
    /// from screen capture — the user's intent, not a read of the live OS
    /// state. `SetWindowDisplayAffinity` has been observed to silently drop
    /// back to normal (capturable) after monitor/DPI changes, GPU driver
    /// resets, or waking from sleep, with no notification when it happens —
    /// so a background watchdog (see `overlay_window::spawn_capture_protection_watchdog`)
    /// re-asserts exclusion on a timer, and needs this flag to know whether
    /// re-asserting is actually wanted (the user's own "Screen Capture
    /// Protection" toggle can turn it off on purpose, which the watchdog
    /// must not fight). Starts `true`: capture protection is on by default.
    pub overlay_capture_protection_desired: AtomicBool,
    /// Long-range Interview Mode conversation memory (current topic/entity +
    /// entities established earlier in the session) — see
    /// `ConversationStateSnapshot`. Kept separate from `transcript`/
    /// `documents` because it tracks the *ask* flow's own state, not
    /// recording/STT or uploaded files. Reset to default at the start of a
    /// fresh Interview Mode session (see `ask_interview_question`, which
    /// resets it whenever the frontend sends empty history).
    pub conversation_state: Mutex<ConversationStateSnapshot>,
    /// Screenshots captured from the overlay's Screenshot button and not yet
    /// sent — (id, model-sized PNG as base64), in capture order. The next
    /// Answer/Deep Answer takes the ones it names and sends them with the
    /// question (see `ask_interview_question`); the overlay only ever holds
    /// the small thumbnails.
    pub screenshots: Mutex<Vec<(String, String)>>,
    /// See `AudioPrebuffer`. `None` whenever no session is starting.
    pub prebuffer: Mutex<Option<AudioPrebuffer>>,
    /// The overlay's Mic toggle (a saved preference, sent on every change):
    /// whether sessions should also hear the user's microphone.
    pub mic_wanted: AtomicBool,
    /// The overlay's call-audio icon: whether to hear what the PC plays.
    /// On by default; the user can turn it off and keep only their mic.
    pub system_wanted: AtomicBool,
    /// What each new session starts with, per mode (set by the main window:
    /// Interview/Meeting hear the call, Assistant hears the user's mic).
    pub system_default: AtomicBool,
    pub mic_default: AtomicBool,
    /// Notes Mode: transcribe the call audio with Deepgram's speaker
    /// diarization (Nova-3) instead of Flux, so each remote voice is told
    /// apart. Latched like `system_wanted` — only changes between sessions.
    pub diarize_call_audio: AtomicBool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            capture: Mutex::default(),
            transcript: Mutex::default(),
            documents: Mutex::default(),
            auth_session: Mutex::default(),
            stt_session: Mutex::default(),
            overlay_capture_protection_desired: AtomicBool::new(true),
            conversation_state: Mutex::default(),
            screenshots: Mutex::default(),
            prebuffer: Mutex::default(),
            mic_wanted: AtomicBool::new(false),
            system_wanted: AtomicBool::new(true),
            system_default: AtomicBool::new(true),
            mic_default: AtomicBool::new(false),
            diarize_call_audio: AtomicBool::new(false),
        }
    }
}
