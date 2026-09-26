use std::io::Write;

use tauri::{Emitter, Manager, State};

use crate::audio::{
    AudioDeviceInfo, AudioDeviceManager, AudioSource, PauseSignal, StopSignal, SystemAudioCapture,
};
use crate::backend::{InterviewAnalysisRequest, SetupAnalysisRequest, SetupAnalysisResponse};
use crate::state::AppState;
use crate::stt::SttClient;
use crate::transcript::{InterviewSession, RecordingState, TranscriptSegment};
use crate::crash_guard::LockExt;

#[derive(Clone, serde::Serialize)]
struct AudioLevelEvent {
    source: AudioSource,
    rms_level: f32,
}

#[derive(Clone, serde::Serialize)]
struct RecordingStateEvent {
    state: RecordingState,
}

#[tauri::command]
pub fn list_output_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    AudioDeviceManager::list_output_devices()
}

#[tauri::command]
pub fn list_input_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    AudioDeviceManager::list_input_devices()
}

/// How long a Start request will wait for a previous session's teardown
/// (`RecordingState::Stopping`) to finish before giving up, when it lands in
/// that narrow window rather than seeing a clean `Idle`/`Stopped`. Bounded
/// and polled once per interval — never an unbounded/forever retry — so a
/// genuinely stuck teardown still surfaces a clear error instead of hanging
/// the caller.
const STOPPING_WAIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const STOPPING_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(50);

/// Starts the full pipeline: WASAPI system-audio capture -> Deepgram Flux
/// STT client -> TranscriptManager -> `transcript:update` / `audio:level` events to
/// the frontend. The only network call this makes is the Deepgram WebSocket
/// connection itself; the backend is only contacted separately when the user
/// explicitly clicks "Analyze Interview" (see docs/architecture.md).
///
/// Deterministic lifecycle: `Idle`/`Stopped` -> `Starting` -> (Deepgram
/// connection confirmed ready -> audio capture confirmed initialized) ->
/// `Recording`, or -> `Idle` with a real error on any failure along the way,
/// with whatever was already spawned cleaned up before returning. The
/// `Starting` state itself is what makes a second, concurrent Start request
/// harmless (it is rejected immediately with the same "capture already
/// running" every caller already treats as expected — see e.g.
/// `InterviewOverlay.tsx`) instead of racing a second WASAPI/STT startup
/// against the first. A request that instead lands mid-`Stopping` (a
/// previous session's teardown still in flight) waits briefly for it to
/// finish rather than starting a new session while the old one's
/// device/connection handles may still be live. See
/// `docs/performance-tuning.md`'s STT-start-reliability section for the
/// full root-cause writeup this replaces, and its real-i3-latency-diagnosis
/// section for why the connection is established before audio capture
/// rather than after (originally written for the old local-model version of
/// this same ordering problem — the same fix applies to a network connect
/// delay).
#[tauri::command]
pub fn start_system_audio_capture(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("start_system_audio_capture: invoked");

    let mut waited = std::time::Duration::ZERO;
    loop {
        let mut session = state.capture.lock_safe();
        match session.recording_state {
            RecordingState::Idle | RecordingState::Stopped => {
                session.recording_state = RecordingState::Starting;
                break;
            }
            RecordingState::Starting | RecordingState::Recording | RecordingState::Paused => {
                // The exact string every frontend call site already treats
                // as a harmless "someone else already started it" outcome —
                // see e.g. InterviewOverlay.tsx's mount effect, which races
                // this exact call against InterviewSetup's.
                return Err("capture already running".into());
            }
            RecordingState::Stopping => {
                if waited >= STOPPING_WAIT_TIMEOUT {
                    return Err(
                        "a previous session is still shutting down — try again in a moment".into(),
                    );
                }
                drop(session);
                std::thread::sleep(STOPPING_POLL_INTERVAL);
                waited += STOPPING_POLL_INTERVAL;
                continue;
            }
        }
    }
    let _ = app.emit("recording:state", RecordingStateEvent { state: RecordingState::Starting });

    let result = start_capture_inner(&app, &state);

    match &result {
        Ok(()) => {
            let mut session = state.capture.lock_safe();
            session.recording_state = RecordingState::Recording;
            drop(session);
            let _ = app.emit("recording:state", RecordingStateEvent { state: RecordingState::Recording });
            log::info!("start_system_audio_capture: recording started");
        }
        Err(err) => {
            let mut session = state.capture.lock_safe();
            session.recording_state = RecordingState::Idle;
            session.stop_signal = None;
            session.pause_signal = None;
            session.system_audio_thread = None;
            session.pipeline_thread = None;
            drop(session);
            log::error!("start_system_audio_capture: failed to start: {err}");
            let _ = app.emit("recording:state", RecordingStateEvent { state: RecordingState::Idle });
        }
    }

    result
}

/// The actual startup sequence, factored out of `start_system_audio_capture`
/// so the state-machine bookkeeping (guard, rollback, event emission) around
/// it stays in one place regardless of which step fails. Everything spawned
/// here that later steps depend on is cleaned up on its own failure path
/// before returning `Err` — no partially-started session is ever left
/// behind for the caller to roll back blindly.
/// Longest a prebuffer may record without becoming a session — a start that
/// fails or is abandoned without an explicit stop is cut off after this.
const PREBUFFER_MAX: std::time::Duration = std::time::Duration::from_secs(30);
static PREBUFFER_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
/// Serializes begin calls (the shortcut and the main window's start both
/// request one), so exactly one prebuffer is ever created per start.
static PREBUFFER_BEGIN: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Starts recording system audio right now, into a local buffer, for a
/// session that's about to start — the press shouldn't wait ~3s for the
/// session key and Deepgram connection before anything is captured. Sends
/// nothing anywhere; `start_system_audio_capture` attaches the STT pipeline
/// to it once connected. Idempotent while one is already buffering. A
/// capture left running from an earlier session is stopped first, never
/// reused (it would still be tied to that session's key).
pub fn begin_audio_prebuffer_inner(app: &tauri::AppHandle) -> Result<(), String> {
    let _serial = PREBUFFER_BEGIN.lock_safe();
    let state = app.state::<AppState>();
    if state.prebuffer.lock_safe().is_some() {
        return Ok(());
    }
    let stale = matches!(
        state.capture.lock_safe().recording_state,
        RecordingState::Recording | RecordingState::Paused
    );
    if stale {
        let _ = stop_audio_capture(app.clone(), app.state::<AppState>());
    }

    // The call audio unless it's off for this session (Assistant Mode).
    let system = if state.system_wanted.load(std::sync::atomic::Ordering::Relaxed) {
        Some(start_capture_buffer(AudioSource::SystemAudio)?)
    } else {
        None
    };
    // With the Mic on, the user's voice is recorded from the press too. A
    // mic that can't open never blocks the session itself.
    let mic = if state.mic_wanted.load(std::sync::atomic::Ordering::Relaxed) {
        start_capture_buffer(AudioSource::Microphone)
            .inspect_err(|err| {
                log::warn!("audio prebuffer: microphone couldn't start: {err}");
                let _ = app.emit("audio:mic-error", err.clone());
            })
            .ok()
    } else {
        None
    };
    if system.is_none() && mic.is_none() {
        return Ok(());
    }
    let id = PREBUFFER_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    *state.prebuffer.lock_safe() = Some(crate::state::AudioPrebuffer { id, system, mic });
    log::info!("audio prebuffer {id}: recording from the key press until the session is ready");
    // Lets the overlay show it is listening right away, not only once the
    // session has finished connecting.
    let _ = app.emit("audio:prebuffer", true);

    let watchdog_app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(PREBUFFER_MAX);
        if discard_audio_prebuffer(&watchdog_app, Some(id)) {
            log::warn!("audio prebuffer {id}: never became a session — discarded after {}s", PREBUFFER_MAX.as_secs());
        }
    });
    Ok(())
}

/// Stops and drops the prebuffer (only if it's `only_id`, when given).
/// Returns whether one was discarded.
fn discard_audio_prebuffer(app: &tauri::AppHandle, only_id: Option<u64>) -> bool {
    let taken = {
        let state = app.state::<AppState>();
        let mut slot = state.prebuffer.lock_safe();
        match (&*slot, only_id) {
            (Some(p), Some(id)) if p.id != id => None,
            _ => slot.take(),
        }
    };
    let Some(prebuffer) = taken else { return false };
    if let Some(system) = prebuffer.system {
        stop_capture_buffer(system);
    }
    if let Some(mic) = prebuffer.mic {
        stop_capture_buffer(mic);
    }
    let _ = app.emit("audio:prebuffer", false);
    true
}

/// Starts recording one source into a local buffer (nothing is sent
/// anywhere until a speech-to-text connection takes it over).
fn start_capture_buffer(source: AudioSource) -> Result<crate::state::CaptureBuffer, String> {
    let (audio_tx, audio_rx) = crossbeam_channel::unbounded();
    let stop = StopSignal::new();
    let thread = match source {
        AudioSource::SystemAudio => SystemAudioCapture::start(audio_tx, stop.clone())?,
        AudioSource::Microphone => crate::audio::MicrophoneCapture::start(audio_tx, stop.clone())?,
    };
    Ok(crate::state::CaptureBuffer { audio_rx, stop, thread })
}

fn stop_capture_buffer(buffer: crate::state::CaptureBuffer) {
    buffer.stop.stop();
    let _ = buffer.thread.join();
}

#[tauri::command]
pub async fn begin_audio_prebuffer(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || begin_audio_prebuffer_inner(&app))
        .await
        .map_err(|e| e.to_string())?
}

/// Applies one speech-to-text event (from either source) to the transcript,
/// journals finished sentences to disk, and tells both windows.
fn record_stt_event(app: &tauri::AppHandle, event: crate::stt::SttEvent) {
    let state = app.state::<AppState>();
    let (segment, session_id, session_started_at_ms) = {
        let mut manager = state.transcript.lock_safe();
        let segment = manager.apply_event(event);
        let session = manager.session();
        (segment, session.id.clone(), session.started_at_ms)
    };
    if let Some(segment) = segment {
        // Written to disk before anything else touches it, so a crash right
        // after can't lose this sentence.
        if let Some(text) = segment.final_text.as_deref() {
            crate::history::journal_record(app, &session_id, session_started_at_ms, segment.source, text, segment.timestamp);
        }
        let _ = app.emit("transcript:update", &segment);
    }
}

/// Serializes turning either audio source on/off, so a quick on-off-on can
/// never leave two connections running for one source, or one running that
/// the user turned off.
static SOURCE_OP: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn source_label(source: AudioSource) -> &'static str {
    match source {
        AudioSource::SystemAudio => "call audio",
        AudioSource::Microphone => "microphone",
    }
}

/// Whether the user wants this source heard (the overlay's two icons).
fn source_wanted(state: &AppState, source: AudioSource) -> bool {
    let flag = match source {
        AudioSource::SystemAudio => &state.system_wanted,
        AudioSource::Microphone => &state.mic_wanted,
    };
    flag.load(std::sync::atomic::Ordering::Relaxed)
}

fn source_running(session: &crate::state::CaptureSession, source: AudioSource) -> bool {
    match source {
        AudioSource::SystemAudio => session.system_audio_thread.is_some(),
        AudioSource::Microphone => session.mic.is_some(),
    }
}

fn source_state_event(source: AudioSource) -> &'static str {
    match source {
        AudioSource::SystemAudio => "audio:system-state",
        AudioSource::Microphone => "audio:mic-state",
    }
}

/// Starts one audio source alongside the running session: its own capture
/// thread and its own Deepgram connection (same session key), so its
/// sentences arrive tagged with who said them — the call audio ("them") or
/// the user's microphone ("you"). Used when the user turns a source on
/// mid-session, and for the microphone when a session starts with it on.
/// Shares the session's pause signal.
fn start_source_inner(
    app: &tauri::AppHandle,
    source: AudioSource,
    buffered: Option<crate::state::CaptureBuffer>,
) -> Result<(), String> {
    let _serial = SOURCE_OP.lock_safe();
    let state = app.state::<AppState>();
    let discard = |buffered: Option<crate::state::CaptureBuffer>| {
        if let Some(buffer) = buffered {
            stop_capture_buffer(buffer);
        }
    };
    if !source_wanted(&state, source) {
        discard(buffered);
        return Ok(());
    }
    // Starting counts: when a session starts with the Mic on, this runs right
    // as the session registers, a moment before its state reads Recording.
    // The pause signal (checked below) only exists once it has registered.
    let pause = {
        let session = state.capture.lock_safe();
        if source_running(&session, source) {
            drop(session);
            discard(buffered);
            return Ok(());
        }
        if !matches!(session.recording_state, RecordingState::Starting | RecordingState::Recording | RecordingState::Paused) {
            drop(session);
            discard(buffered);
            return Err("Start a session first".into());
        }
        match session.pause_signal.clone() {
            Some(pause) => pause,
            None => {
                drop(session);
                discard(buffered);
                return Err("Start a session first".into());
            }
        }
    };
    let Some(api_key) = state.stt_session.lock_safe().as_ref().map(|session| session.deepgram_key.clone()) else {
        discard(buffered);
        return Err("No active session".into());
    };

    // Recording starts before the connection (which takes about a second):
    // what's said meanwhile queues here and is sent first.
    let crate::state::CaptureBuffer { audio_rx, stop, thread: capture_thread } = match buffered {
        Some(buffer) => buffer,
        None => start_capture_buffer(source)?,
    };
    let (stt_tx, stt_rx) = std::sync::mpsc::channel();
    let stt_client = match SttClient::spawn(source, stt_tx, api_key, Some(app.clone())) {
        Ok(client) => client,
        Err(err) => {
            stop.stop();
            let _ = capture_thread.join();
            return Err(err);
        }
    };

    let pipeline_app = app.clone();
    let pipeline_thread = std::thread::Builder::new()
        .name(format!("{}-stt-pipeline", source_label(source).replace(' ', "-")))
        .spawn(move || {
            let events_app = pipeline_app.clone();
            let events_thread = std::thread::Builder::new()
                .name("source-stt-events".into())
                .spawn(move || {
                    for event in stt_rx.iter() {
                        record_stt_event(&events_app, event);
                    }
                })
                .ok();
            crate::audio::run_stt_pipeline(audio_rx, stt_client, pause, move |chunk| {
                let _ = pipeline_app.emit(
                    "audio:level",
                    AudioLevelEvent {
                        source: chunk.source,
                        rms_level: chunk.rms_level,
                    },
                );
            });
            if let Some(handle) = events_thread {
                let _ = handle.join();
            }
        })
        .map_err(|e| e.to_string())?;

    let mut session = state.capture.lock_safe();
    // The session may have ended while the connection was being set up.
    if !matches!(session.recording_state, RecordingState::Starting | RecordingState::Recording | RecordingState::Paused)
        || source_running(&session, source)
    {
        drop(session);
        stop.stop();
        let _ = capture_thread.join();
        let _ = pipeline_thread.join();
        return Err("The session ended".into());
    }
    match source {
        AudioSource::SystemAudio => {
            session.stop_signal = Some(stop);
            session.system_audio_thread = Some(capture_thread);
            session.pipeline_thread = Some(pipeline_thread);
        }
        AudioSource::Microphone => {
            session.mic = Some(crate::state::MicSession { stop, capture_thread, pipeline_thread });
        }
    }
    drop(session);
    log::info!("{}: on", source_label(source));
    let _ = app.emit(source_state_event(source), true);
    Ok(())
}

/// Stops one audio source (if running), finalizing anything mid-sentence.
/// The session keeps running — the other source, the timer, the answers.
fn stop_source_inner(app: &tauri::AppHandle, source: AudioSource) {
    let parts = {
        let state = app.state::<AppState>();
        let mut session = state.capture.lock_safe();
        match source {
            AudioSource::SystemAudio => match (session.stop_signal.take(), session.system_audio_thread.take(), session.pipeline_thread.take()) {
                (Some(stop), Some(capture), pipeline) => Some((stop, capture, pipeline)),
                (stop, capture, pipeline) => {
                    // Nothing (fully) running: put back whatever was there.
                    session.stop_signal = stop;
                    session.system_audio_thread = capture;
                    session.pipeline_thread = pipeline;
                    None
                }
            },
            AudioSource::Microphone => session.mic.take().map(|mic| (mic.stop, mic.capture_thread, Some(mic.pipeline_thread))),
        }
    };
    if let Some((stop, capture_thread, pipeline_thread)) = parts {
        stop.stop();
        let _ = capture_thread.join();
        if let Some(handle) = pipeline_thread {
            let _ = handle.join();
        }
        log::info!("{}: off", source_label(source));
        let _ = app.emit(source_state_event(source), false);
    }
}

/// Turns one source on/off. Also sent by the overlay when it loads. Returns
/// whether the source is running now (`false` between sessions).
async fn set_source_enabled(app: tauri::AppHandle, source: AudioSource, enabled: bool) -> Result<bool, String> {
    let flag = match source {
        AudioSource::SystemAudio => &app.state::<AppState>().system_wanted,
        AudioSource::Microphone => &app.state::<AppState>().mic_wanted,
    };
    flag.store(enabled, std::sync::atomic::Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let live = matches!(state.capture.lock_safe().recording_state, RecordingState::Recording | RecordingState::Paused);
        if enabled {
            if live {
                return start_source_inner(&app, source, None).map(|()| true);
            }
            // A session is starting (recording since the key press): the
            // mic records from now too; the session picks it up when ready.
            // (The call audio is always recorded from the key press.)
            if source == AudioSource::Microphone {
                if let Some(prebuffer) = state.prebuffer.lock_safe().as_mut() {
                    if prebuffer.mic.is_none() {
                        prebuffer.mic = Some(start_capture_buffer(AudioSource::Microphone)?);
                    }
                }
            }
            Ok(false)
        } else {
            let _serial = SOURCE_OP.lock_safe();
            stop_source_inner(&app, source);
            if source == AudioSource::Microphone {
                let buffered = state.prebuffer.lock_safe().as_mut().and_then(|p| p.mic.take());
                if let Some(buffer) = buffered {
                    stop_capture_buffer(buffer);
                }
            }
            Ok(false)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The overlay's your-voice icon: also hear the user's own microphone.
#[tauri::command]
pub async fn set_microphone_enabled(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    set_source_enabled(app, AudioSource::Microphone, enabled).await
}

/// The overlay's call-audio icon: hear what the PC plays (the other side).
#[tauri::command]
pub async fn set_system_audio_enabled(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    set_source_enabled(app, AudioSource::SystemAudio, enabled).await
}

/// Connects the user's microphone for a session that just started, off the
/// calling thread so Start never waits on it. It has been recording since the
/// key press if the Mic was already on.
fn spawn_mic_start(app: &tauri::AppHandle, mic_buffer: Option<crate::state::CaptureBuffer>) {
    let state = app.state::<AppState>();
    if mic_buffer.is_none() && !state.mic_wanted.load(std::sync::atomic::Ordering::Relaxed) {
        return;
    }
    let mic_app = app.clone();
    std::thread::spawn(move || {
        if let Err(err) = start_source_inner(&mic_app, AudioSource::Microphone, mic_buffer) {
            log::warn!("microphone: couldn't start with the session: {err}");
            let _ = mic_app.emit("audio:mic-error", err);
        }
    });
}

/// Which sources a new session starts with in the current mode (the main
/// window sends this whenever the mode changes). Takes effect right away
/// between sessions; a live session keeps what it has.
#[tauri::command]
pub fn set_source_defaults(state: State<'_, AppState>, system: bool, mic: bool) {
    apply_source_defaults(&state, system, mic);
}

/// See `set_source_defaults`; also used by the mode shortcuts.
pub fn apply_source_defaults(state: &AppState, system: bool, mic: bool) {
    use std::sync::atomic::Ordering::Relaxed;
    state.system_default.store(system, Relaxed);
    state.mic_default.store(mic, Relaxed);
    let busy = state.prebuffer.lock_safe().is_some()
        || !matches!(
            state.capture.lock_safe().recording_state,
            RecordingState::Idle | RecordingState::Stopped
        );
    if !busy {
        state.system_wanted.store(system, Relaxed);
        state.mic_wanted.store(mic, Relaxed);
    }
}

fn start_capture_inner(app: &tauri::AppHandle, state: &State<'_, AppState>) -> Result<(), String> {
    {
        let mut transcript = state.transcript.lock_safe();
        transcript.clear();
    }

    let (stt_tx, stt_rx) = std::sync::mpsc::channel();

    // The Deepgram key comes from `start_backend_session` (called by the
    // frontend right before this), which mints a short-lived, scoped key and
    // stashes it here — there's no local fallback if that wasn't called or
    // failed, since there's no stored user key anymore.
    let api_key = {
        let slot = state.stt_session.lock_safe();
        slot.as_ref()
            .map(|session| session.deepgram_key.clone())
            .ok_or_else(|| "No active backend session — please try again".to_string())?
    };

    // Audio already being recorded since the key press (see
    // `begin_audio_prebuffer_inner`) — this session takes it over, so its
    // stop signal becomes the session's. Its microphone part (if any) is
    // handed to the mic's own connection once the session is running.
    let mut prebuffer = state.prebuffer.lock_safe().take();
    let mic_buffer = prebuffer.as_mut().and_then(|p| p.mic.take());
    let system_buffer = prebuffer.and_then(|p| p.system);

    // Call audio off for this session (Assistant Mode's default): no call
    // capture and no call connection at all — only the mic, if it's on.
    if !state.system_wanted.load(std::sync::atomic::Ordering::Relaxed) {
        if let Some(system) = system_buffer {
            stop_capture_buffer(system);
        }
        state.capture.lock_safe().pause_signal = Some(PauseSignal::new());
        spawn_mic_start(app, mic_buffer);
        return Ok(());
    }

    let stop = system_buffer.as_ref().map(|b| b.stop.clone()).unwrap_or_else(StopSignal::new);
    let pause = PauseSignal::new();

    let session_start = crate::hardware::telemetry::Stopwatch::start();

    // The Deepgram connection is established BEFORE audio capture starts —
    // deliberately reversed from the naive order. `SttClient::spawn` blocks
    // until Deepgram confirms the connection (see stt/client.rs). Starting
    // audio capture first meant WASAPI spent that entire connect window
    // pushing chunks into an unbounded channel with nothing yet consuming
    // them — on slow/high-latency networks that produced a real backlog:
    // silence for a few seconds, then the backlogged audio flushed in a
    // burst the instant the connection came up, before settling into
    // real-time. Starting the connection first means no audio channel — and
    // so no backlog — exists until STT is already able to keep up with it.
    // See `docs/performance-tuning.md`'s real-i3-latency-diagnosis section
    // (written for the old local-model version of this same problem; the
    // same ordering fix applies to a network connect delay).
    let stt_client = match SttClient::spawn(AudioSource::SystemAudio, stt_tx, api_key, Some(app.clone())) {
        Ok(client) => client,
        Err(err) => {
            // No pipeline exists yet; a prebuffer recording since the key
            // press must not be left running.
            if let Some(system) = system_buffer {
                stop_capture_buffer(system);
            }
            if let Some(mic) = mic_buffer {
                stop_capture_buffer(mic);
            }
            return Err(err);
        }
    };
    // Each log site reads a fresh `perf_context(app)` rather than one
    // captured up front, so it reflects whatever pressure state is actually
    // in effect for this session rather than a stale snapshot from before
    // the Deepgram connection was established.
    crate::hardware::telemetry::log_stage_ms(
        crate::hardware::telemetry::PipelineStage::SttReady,
        session_start.elapsed().as_millis(),
        &crate::hardware::perf_context(app),
    );

    // Audio capture starts only now that the Deepgram connection is
    // confirmed ready to consume it — no window remains during which chunks
    // can queue up unread.
    // Unused when a prebuffer is taken over below (its own receiver is used).
    let (audio_tx, audio_rx) = crossbeam_channel::unbounded();
    // TEMP DIAGNOSTIC: a sender clone purely for polling backlog depth
    // (`.len()`) — crossbeam senders/receivers are safe to clone for a
    // second producer, but never clone the *receiver* for this purpose, as
    // that would steal chunks meant for the real pipeline. Expected to stay
    // ~0 now that capture only starts once STT is ready.
    //
    // Only created when STT_DIAG=1: the audio pipeline exits when this
    // channel disconnects (every sender dropped), so a sender that outlives
    // the capture thread keeps the pipeline thread alive forever and makes
    // `stop_audio_capture` block on joining it. Unconditionally holding one
    // here did exactly that for every session.
    let audio_tx_for_diag = std::env::var("STT_DIAG")
        .map(|v| v == "1")
        .unwrap_or(false)
        .then(|| audio_tx.clone());

    // With a prebuffer, capture has been running since the key press and its
    // queued chunks go to Deepgram first (Deepgram takes a few seconds of
    // backlog faster than real time), then live audio follows. The old
    // reasoning for connecting before capturing — avoiding a backlog burst —
    // was about a local model that couldn't keep up; here the backlog is the
    // speech the user would otherwise have lost.
    let (audio_rx, audio_thread) = if let Some(system) = system_buffer {
        drop(audio_tx);
        (system.audio_rx, system.thread)
    } else {
        match SystemAudioCapture::start(audio_tx, stop.clone()) {
            Ok(handle) => (audio_rx, handle),
            Err(err) => {
                // The Deepgram connection is already established at this point —
                // shut it down cleanly before surfacing the error, so a failed
                // Start never leaves an orphaned connection running.
                stt_client.shutdown();
                return Err(err);
            }
        }
    };
    crate::hardware::telemetry::log_stage_ms(
        crate::hardware::telemetry::PipelineStage::AudioCaptureReady,
        session_start.elapsed().as_millis(),
        &crate::hardware::perf_context(app),
    );
    // By this point the whole startup sequence — Deepgram connection AND
    // audio capture init — is confirmed complete.
    crate::hardware::telemetry::finish(
        session_start,
        crate::hardware::telemetry::PipelineStage::SttSessionStart,
        &crate::hardware::perf_context(app),
    );

    let app_for_pipeline = app.clone();
    let pause_for_pipeline = pause.clone();

    // ===== TEMP DIAGNOSTIC INSTRUMENTATION — STT latency investigation =====
    // Gated behind STT_DIAG=1 (OFF by default): read-only logging, changes no
    // STT/RAG/VAD/endpointing behavior. For removal after the investigation
    // — see docs/performance-tuning.md's real-i3-latency-diagnosis section.
    let diag_enabled = std::env::var("STT_DIAG").map(|v| v == "1").unwrap_or(false);
    let diag_start = std::time::Instant::now();
    if diag_enabled {
        let diag_stop = stop.clone();
        let diag_app = app.clone();
        std::thread::Builder::new()
            .name("diag-resource-sampler".into())
            .spawn(move || {
                let mut sys = sysinfo::System::new_all();
                while !diag_stop.is_stopped() {
                    std::thread::sleep(std::time::Duration::from_millis(1000));
                    sys.refresh_cpu_usage();
                    let cpu = sys.global_cpu_usage();
                    let avail = crate::hardware::available_ram_mb();
                    let pressure = crate::hardware::perf_context(&diag_app).pressure;
                    log::info!(
                        "DIAG t={}ms cpu={:.1}% avail_ram_mb={} pressure={:?}",
                        diag_start.elapsed().as_millis(),
                        cpu,
                        avail,
                        pressure,
                    );
                }
            })
            .ok();
    }
    // ===== END TEMP DIAGNOSTIC (resource sampler) =====

    let pipeline_thread = std::thread::Builder::new()
        .name("audio-stt-pipeline".into())
        .spawn(move || {
            // Forward audio chunks to Deepgram and levels to the UI, on this
            // thread, while a second thread below drains STT events. Two separate
            // threads are required so sending audio never blocks waiting for
            // the WebSocket's inbound events to be read.
            let stt_events_app = app_for_pipeline.clone();
            let events_thread = std::thread::Builder::new()
                .name("stt-events-forwarder".into())
                .spawn(move || {
                    // First-partial/first-final latency, measured from this
                    // forwarder thread's own start (which begins essentially
                    // at session start) to the first occurrence of each
                    // event kind — the number the user actually experiences
                    // (audio flowing -> text appearing), not a cross-process
                    // clock reconciliation with Deepgram's own event
                    // timestamps.
                    let stt_clock = crate::hardware::telemetry::Stopwatch::start();
                    let mut first_partial_logged = false;
                    let mut first_final_logged = false;

                    for event in stt_rx.iter() {
                        // ===== TEMP DIAGNOSTIC: every partial/final, not just
                        // the first — text length only, never content, per
                        // telemetry.rs's existing no-content-logging rule.
                        if diag_enabled {
                            log::info!(
                                "DIAG t={}ms stt_event kind={:?} text_len={}",
                                diag_start.elapsed().as_millis(),
                                event.kind,
                                event.text.len(),
                            );
                        }
                        // ===== END TEMP DIAGNOSTIC =====

                        if !first_partial_logged && event.kind == crate::stt::SttEventKind::Partial {
                            first_partial_logged = true;
                            crate::hardware::telemetry::log_stage_ms(
                                crate::hardware::telemetry::PipelineStage::SttFirstPartial,
                                stt_clock.elapsed().as_millis(),
                                &crate::hardware::perf_context(&stt_events_app),
                            );
                        }
                        if !first_final_logged && event.kind == crate::stt::SttEventKind::Final {
                            first_final_logged = true;
                            crate::hardware::telemetry::log_stage_ms(
                                crate::hardware::telemetry::PipelineStage::SttFinal,
                                stt_clock.elapsed().as_millis(),
                                &crate::hardware::perf_context(&stt_events_app),
                            );
                        }

                        record_stt_event(&stt_events_app, event);
                    }
                })
                .ok();

            // ===== TEMP DIAGNOSTIC: RMS-threshold speech onset/offset
            // detector, purely observational (does NOT feed Deepgram's own
            // end-of-turn detection), plus outbound channel backlog at each
            // transition, to see whether audio is queuing up behind STT
            // rather than being delivered promptly.
            let diag_audio_tx = audio_tx_for_diag.clone();
            let mut diag_speaking = false;
            // ===== END TEMP DIAGNOSTIC (setup) =====

            // The loop itself lives in `audio::pipeline` so that the headless
            // `pipeline_test` binary drives the same code rather than a copy.
            crate::audio::run_stt_pipeline(audio_rx, stt_client, pause_for_pipeline, move |chunk| {
                let _ = app_for_pipeline.emit(
                    "audio:level",
                    AudioLevelEvent {
                        source: chunk.source,
                        rms_level: chunk.rms_level,
                    },
                );
                // ===== TEMP DIAGNOSTIC =====
                if diag_enabled {
                    const SPEECH_RMS_THRESHOLD: f32 = 0.02;
                    let is_speech = chunk.rms_level > SPEECH_RMS_THRESHOLD;
                    if is_speech && !diag_speaking {
                        diag_speaking = true;
                        log::info!(
                            "DIAG t={}ms speech_onset rms={:.4} backlog={}",
                            diag_start.elapsed().as_millis(),
                            chunk.rms_level,
                            diag_audio_tx.as_ref().map_or(0, |tx| tx.len()),
                        );
                    } else if !is_speech && diag_speaking {
                        diag_speaking = false;
                        log::info!(
                            "DIAG t={}ms speech_offset rms={:.4} backlog={}",
                            diag_start.elapsed().as_millis(),
                            chunk.rms_level,
                            diag_audio_tx.as_ref().map_or(0, |tx| tx.len()),
                        );
                    }
                }
                // ===== END TEMP DIAGNOSTIC =====
            });

            if let Some(handle) = events_thread {
                let _ = handle.join();
            }
        })
        .map_err(|e| e.to_string())?;

    {
        let mut session = state.capture.lock_safe();
        session.stop_signal = Some(stop);
        session.pause_signal = Some(pause);
        session.system_audio_thread = Some(audio_thread);
        session.pipeline_thread = Some(pipeline_thread);
    }

    // The user's microphone gets its own connection, set up off this thread
    // so the session's Start never waits on it. It has been recording since
    // the key press if the Mic was already on.
    spawn_mic_start(app, mic_buffer);
    // The user turned the call audio off while the session was starting.
    if !state.system_wanted.load(std::sync::atomic::Ordering::Relaxed) {
        let system_app = app.clone();
        std::thread::spawn(move || {
            let _serial = SOURCE_OP.lock_safe();
            stop_source_inner(&system_app, AudioSource::SystemAudio);
        });
    }
    Ok(())
}

/// Pauses recording: audio capture keeps running internally (so the OS device
/// buffer never overflows) but no audio reaches Deepgram or the UI meter,
/// and no transcript segment changes. The Deepgram connection is left open so
/// resuming is instant and the transcript-so-far is untouched.
#[tauri::command]
pub fn pause_recording(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("pause_recording: invoked");
    let mut session = state.capture.lock_safe();
    let Some(pause) = session.pause_signal.as_ref() else {
        return Err("no active recording to pause".into());
    };
    if session.recording_state != RecordingState::Recording {
        return Err(format!(
            "cannot pause from state {:?}",
            session.recording_state
        ));
    }
    pause.set_paused(true);
    session.recording_state = RecordingState::Paused;
    drop(session);

    {
        let mut transcript = state.transcript.lock_safe();
        transcript.mark_paused();
    }

    let _ = app.emit(
        "recording:state",
        RecordingStateEvent {
            state: RecordingState::Paused,
        },
    );
    log::info!("pause_recording: done");
    Ok(())
}

#[tauri::command]
pub fn resume_recording(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("resume_recording: invoked");
    let mut session = state.capture.lock_safe();
    let Some(pause) = session.pause_signal.as_ref() else {
        return Err("no active recording to resume".into());
    };
    if session.recording_state != RecordingState::Paused {
        return Err(format!(
            "cannot resume from state {:?}",
            session.recording_state
        ));
    }
    pause.set_paused(false);
    session.recording_state = RecordingState::Recording;
    drop(session);

    {
        let mut transcript = state.transcript.lock_safe();
        transcript.mark_resumed();
    }

    let _ = app.emit(
        "recording:state",
        RecordingStateEvent {
            state: RecordingState::Recording,
        },
    );
    log::info!("resume_recording: done");
    Ok(())
}

/// Stops recording: halts WASAPI capture, flushes and finalizes the Deepgram
/// connection (so any in-progress utterance is finalized rather than dropped),
/// and marks the session as completed. Does not contact the backend — that
/// only happens if/when the user explicitly clicks "Analyze Interview".
#[tauri::command]
pub fn stop_audio_capture(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    log::info!("stop_audio_capture: invoked");
    // A start that's being abandoned may have been recording since the key
    // press without ever becoming a session — stop that too.
    if discard_audio_prebuffer(&app, None) {
        log::info!("stop_audio_capture: discarded an unattached prebuffer");
    }
    // The microphone rides on this session's key and pause signal — it ends
    // with it. The next session starts with the current mode's defaults.
    stop_source_inner(&app, AudioSource::Microphone);
    {
        use std::sync::atomic::Ordering::Relaxed;
        let state = app.state::<AppState>();
        state.mic_wanted.store(state.mic_default.load(Relaxed), Relaxed);
        state.system_wanted.store(state.system_default.load(Relaxed), Relaxed);
    }
    // Take the handles out and drop the lock *before* joining threads below —
    // joining can block for as long as the Deepgram connection takes to flush
    // and close, and holding `state.capture` for that whole span would
    // deadlock every other recording command (get_recording_state,
    // pause/resume, a fresh start) that also needs this same mutex while
    // Stop is still in flight. The `Stopping` state set here (rather than
    // jumping straight to `Stopped`) is what a concurrent Start request sees
    // and waits on instead of racing a new WASAPI/STT session against this
    // teardown's still-live device/connection handles — see
    // `start_system_audio_capture`.
    let (pause_signal, stop_signal, system_audio_thread, pipeline_thread) = {
        let mut session = state.capture.lock_safe();
        session.recording_state = RecordingState::Stopping;
        (
            session.pause_signal.take(),
            session.stop_signal.take(),
            session.system_audio_thread.take(),
            session.pipeline_thread.take(),
        )
    };
    let _ = app.emit("recording:state", RecordingStateEvent { state: RecordingState::Stopping });

    if let Some(pause) = pause_signal {
        // Make sure a paused pipeline thread doesn't sit forever skipping chunks;
        // stopping the capture thread below closes its channel either way, but
        // un-pausing first ensures any final in-flight chunk still reaches STT.
        pause.set_paused(false);
    }
    if let Some(stop) = stop_signal {
        stop.stop();
    }
    if let Some(handle) = system_audio_thread {
        let _ = handle.join();
    }
    if let Some(handle) = pipeline_thread {
        let _ = handle.join();
    }

    {
        let mut transcript = state.transcript.lock_safe();
        // Anything still mid-sentence when the recording stopped is kept too.
        let flushed = transcript.flush_partials();
        let session = transcript.session();
        for segment in &flushed {
            if let Some(text) = segment.final_text.as_deref() {
                crate::history::journal_record(
                    &app,
                    &session.id,
                    session.started_at_ms,
                    segment.source,
                    text,
                    segment.timestamp,
                );
            }
        }
        transcript.mark_stopped();
    }

    {
        let mut session = state.capture.lock_safe();
        session.recording_state = RecordingState::Stopped;
    }

    let _ = app.emit(
        "recording:state",
        RecordingStateEvent {
            state: RecordingState::Stopped,
        },
    );
    log::info!("stop_audio_capture: done");
    Ok(())
}

#[tauri::command]
pub fn get_current_session(state: State<'_, AppState>) -> Result<InterviewSession, String> {
    let transcript = state.transcript.lock_safe();
    Ok(transcript.session().clone())
}

#[tauri::command]
pub fn get_recording_state(state: State<'_, AppState>) -> Result<RecordingState, String> {
    let session = state.capture.lock_safe();
    Ok(session.recording_state)
}

/// Resets everything to start a brand new interview: any previous recording must
/// already be stopped (recording_state must not be Recording/Paused).
#[tauri::command]
pub fn start_new_interview(state: State<'_, AppState>) -> Result<(), String> {
    let mut session = state.capture.lock_safe();
    if matches!(
        session.recording_state,
        RecordingState::Recording | RecordingState::Paused | RecordingState::Starting | RecordingState::Stopping
    ) {
        return Err("stop the current recording before starting a new interview".into());
    }
    session.recording_state = RecordingState::Idle;
    session.pause_signal = None;
    session.stop_signal = None;
    drop(session);

    let mut transcript = state.transcript.lock_safe();
    transcript.clear();
    Ok(())
}

#[tauri::command]
pub fn clear_transcript(state: State<'_, AppState>) -> Result<(), String> {
    let mut transcript = state.transcript.lock_safe();
    transcript.clear();
    Ok(())
}

fn format_hh_mm_ss(total_ms: u64) -> String {
    let total_secs = total_ms / 1000;
    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let seconds = total_secs % 60;
    if hours > 0 {
        format!("{hours:02}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

fn iso8601(ms: u64) -> String {
    // Minimal dependency-free ISO-8601-ish UTC timestamp (date is not computed;
    // we keep this local-storage-only export simple and avoid pulling in a full
    // date/time crate just for file headers/JSON export metadata).
    let secs = ms / 1000;
    let millis = ms % 1000;
    format!("{secs}.{millis:03}Z")
}

/// Opens a native "Save As" dialog and writes the current transcript as plain
/// text. Runs entirely locally — no network call.
#[tauri::command]
pub fn export_transcript_txt(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let session = {
        let transcript = state.transcript.lock_safe();
        transcript.session().clone()
    };

    let mut out = String::new();
    out.push_str("INTERVIEW TRANSCRIPT\n");
    out.push_str(&format!("Session ID: {}\n", session.id));
    out.push_str(&format!("Started: {}\n", iso8601(session.started_at_ms)));
    if let Some(ended) = session.ended_at_ms {
        out.push_str(&format!("Ended: {}\n", iso8601(ended)));
    }
    out.push_str(&format!("Duration: {}\n", format_hh_mm_ss(session.elapsed_ms())));
    out.push_str(&format!("Words: {}\n\n", session.word_count()));

    for segment in &session.segments {
        let Some(text) = segment.final_text.as_deref() else {
            continue;
        };
        let relative_ms = segment
            .start_time
            .map(|s| (s * 1000.0) as u64)
            .unwrap_or(0);
        out.push_str(&format!("[{}]\n", format_hh_mm_ss(relative_ms)));
        out.push_str(text);
        out.push_str("\n\n");
    }

    let default_name = format!("interview-transcript-{}.txt", session.id);
    let Some(path) = pick_save_path(&app, &default_name, "Text", &["txt"])? else {
        return Ok(None);
    };
    write_file(&path, out.as_bytes())?;
    Ok(Some(path))
}

/// Opens a native "Save As" dialog and writes the current transcript as
/// structured JSON. Runs entirely locally — no network call.
#[tauri::command]
pub fn export_transcript_json(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let session = {
        let transcript = state.transcript.lock_safe();
        transcript.session().clone()
    };

    #[derive(serde::Serialize)]
    struct ExportSegment {
        timestamp: String,
        source: AudioSource,
        text: String,
    }

    #[derive(serde::Serialize)]
    struct ExportPayload {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "startedAt")]
        started_at: String,
        #[serde(rename = "endedAt")]
        ended_at: Option<String>,
        #[serde(rename = "durationMs")]
        duration_ms: u64,
        #[serde(rename = "wordCount")]
        word_count: usize,
        segments: Vec<ExportSegment>,
    }

    let payload = ExportPayload {
        session_id: session.id.clone(),
        started_at: iso8601(session.started_at_ms),
        ended_at: session.ended_at_ms.map(iso8601),
        duration_ms: session.elapsed_ms(),
        word_count: session.word_count(),
        segments: session
            .segments
            .iter()
            .filter_map(|s| {
                s.final_text.as_ref().map(|text| ExportSegment {
                    timestamp: iso8601(s.timestamp),
                    source: s.source,
                    text: text.clone(),
                })
            })
            .collect(),
    };

    let json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;

    let default_name = format!("interview-transcript-{}.json", session.id);
    let Some(path) = pick_save_path(&app, &default_name, "JSON", &["json"])? else {
        return Ok(None);
    };
    write_file(&path, json.as_bytes())?;
    Ok(Some(path))
}

fn pick_save_path(
    app: &tauri::AppHandle,
    default_name: &str,
    filter_name: &str,
    extensions: &[&str],
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let path = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter(filter_name, extensions)
        .blocking_save_file();

    Ok(path.map(|p| p.to_string()))
}

fn write_file(path: &str, contents: &[u8]) -> Result<(), String> {
    let mut file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    file.write_all(contents).map_err(|e| e.to_string())?;
    Ok(())
}

/// Personal build: there is no SaaS backend to be connected to. Kept as a
/// permanent `false` no-op rather than removed, in case any future UI code
/// polls it for a connectivity indicator.
#[tauri::command]
pub async fn check_backend_connection() -> Result<bool, String> {
    Ok(false)
}

/// Runs the full Step 10 analysis pipeline: extract question/answer pairs
/// from the finalized transcript (deterministic, local, no LLM — see
/// `crate::analyzer`), then stream the resulting question set to the LLM
/// for analysis. Only reachable from
/// the "Analyze Interview" button on the post-stop summary screen — never
/// called automatically when recording stops. Sends text only
/// (transcript-derived question/answer text); no audio, no original
/// documents.
///
/// Streams progress as `analysis:progress` Tauri events (one per SSE event
/// from the backend) so the frontend can show incremental status without the
/// command needing to return until the whole analysis finishes.
#[tauri::command]
pub async fn analyze_interview(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    role: Option<String>,
    company: Option<String>,
    job_description: Option<String>,
) -> Result<crate::backend::OverallInterviewAnalysis, String> {
    let session = {
        let transcript = state.transcript.lock_safe();
        transcript.session().clone()
    };

    if session.segments.is_empty() {
        return Err("cannot analyze an empty transcript".into());
    }

    let qa_pairs = crate::analyzer::extract_question_answers(&session);
    let wire_question_answers = qa_pairs
        .iter()
        .map(|pair| crate::backend::WireQuestionAnswer {
            question_id: pair.question_id.clone(),
            question: pair.question.clone(),
            candidate_answer: pair.candidate_answer.clone(),
            timestamp: pair.timestamp.clone(),
        })
        .collect();

    let request = build_analysis_request(&session, role, company, job_description, wire_question_answers);

    let app_for_events = app.clone();
    let on_event = move |event: &crate::backend::AnalysisProgressEvent| {
        let _ = app_for_events.emit("analysis:progress", event);
    };
    let access_token = crate::auth::current_access_token(&state).await?;
    crate::personal::DirectLlmClient::new(None, access_token).analyze_stream(&request, on_event).await
}

fn build_analysis_request(
    session: &InterviewSession,
    role: Option<String>,
    company: Option<String>,
    job_description: Option<String>,
    question_answers: Vec<crate::backend::WireQuestionAnswer>,
) -> InterviewAnalysisRequest {
    let segments = session
        .segments
        .iter()
        .filter_map(|segment| wire_segment(session, segment))
        .collect();

    InterviewAnalysisRequest {
        session_id: session.id.clone(),
        role,
        company,
        job_description,
        candidate_context: None,
        transcript: crate::backend::WireTranscript {
            duration_seconds: session.elapsed_ms() / 1000,
            segments,
        },
        question_answers,
    }
}

fn wire_segment(
    session: &InterviewSession,
    segment: &TranscriptSegment,
) -> Option<crate::backend::WireTranscriptSegment> {
    let text = segment.final_text.clone()?;
    let relative_ms = segment.timestamp.saturating_sub(session.started_at_ms);
    Some(crate::backend::WireTranscriptSegment {
        timestamp: format_relative_timestamp(relative_ms),
        source: match segment.source {
            AudioSource::SystemAudio => crate::backend::WireAudioSource::SystemAudio,
            AudioSource::Microphone => crate::backend::WireAudioSource::Microphone,
        },
        text,
    })
}

fn format_relative_timestamp(ms: u64) -> String {
    let total_secs = ms / 1000;
    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let seconds = total_secs % 60;
    if hours > 0 {
        format!("{hours:02}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

/// New Interview setup page's auto-analysis: summarizes pasted/uploaded CV
/// and job-description text into a short "Interview Focus" for the setup
/// page to display — unlike the commands below it does not require the
/// document extraction service to be available.
#[tauri::command]
pub async fn analyze_setup_context(
    state: State<'_, AppState>,
    resume_text: Option<String>,
    job_description_text: Option<String>,
) -> Result<SetupAnalysisResponse, String> {
    let request = SetupAnalysisRequest { resume_text, job_description_text };
    let access_token = crate::auth::current_access_token(&state).await?;
    crate::personal::DirectLlmClient::new(None, access_token).analyze_setup(&request).await
}

/// Terminates the whole process, not just the calling window. The Interview
/// Mode overlay window is built once and only ever hidden/shown after that
/// (see `overlay_window.rs`) — it's never destroyed — so once a session has
/// opened it at least once, a plain `mainWindow.destroy()` from the title
/// bar's close button leaves that hidden, `skip_taskbar` window alive and
/// the process running invisibly in the background instead of actually
/// quitting. `app.exit(0)` tears down every window unconditionally.
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// Reasserts capture exclusion for the calling window once its content has
/// actually loaded and painted — called once from `src/main.tsx` on mount,
/// so it fires for whichever window (main/overlay/bubble) just loaded,
/// `window` being Tauri's automatically-injected handle to the caller.
///
/// Why this exists: exclusion is applied at window-creation time, before
/// the window has any content — it's hidden and empty at that point (see
/// `build_overlay_window`/`build_bubble_window`/the main-window setup in
/// `lib.rs`, all of which call `windows_capture_protection::reconcile`
/// before `.show()`). WebView2 attaches its own compositor/DirectComposition
/// visual to the window asynchronously afterward, as content actually loads.
/// If DWM builds its alternate "what a capture consumer sees instead of this
/// excluded window" composition before that visual is attached, and doesn't
/// regenerate it once it is, the capture-facing surface can end up wrong for
/// the rest of that window's life — no watchdog reassertion or later
/// `reconcile` call would fix that on its own, since the *value* being
/// re-set never actually changes, only presence-of-real-content does.
/// Reapplying once real content is on-screen gives DWM a fully-initialized
/// window to build that alternate composition from in the first place.
#[tauri::command]
pub fn signal_window_content_ready(window: tauri::WebviewWindow, app: tauri::AppHandle) {
    let label = window.label().to_string();
    let desired = if label == crate::interview_mode::OVERLAY_WINDOW_LABEL {
        app.try_state::<AppState>()
            .map(|s| s.overlay_capture_protection_desired.load(std::sync::atomic::Ordering::Relaxed))
            .unwrap_or(true)
    } else {
        true
    };
    crate::windows_capture_protection::reconcile(&window, &label, desired);
}

/// Called from the title bar's Minimize button instead of a real OS
/// minimize: the main window is `skip_taskbar` (see main_window.rs), so a
/// genuinely minimized window would have no taskbar entry to restore it
/// from. Collapses to the small floating logo bubble instead — see
/// `bubble_window`.
///
/// Window creation/show/hide on Windows must happen on the main thread (the
/// one that owns the window message loop). Tauri dispatches non-async
/// `#[tauri::command]`s onto its blocking thread pool instead, so calling
/// `bubble_window`'s `WebviewWindowBuilder`/`show`/`hide` calls directly from
/// here deadlocked silently — the click reached this command (logged) and
/// then just hung forever, which is exactly what read as "nothing happens"
/// when tapping Minimize/Close. Routed through `run_on_main` (same fix
/// `interview_mode::commands` already uses for its overlay window) instead.
#[tauri::command]
pub async fn minimize_to_bubble(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("minimize_to_bubble: invoked");
    let result = run_on_main(&app, |app| crate::bubble_window::show_bubble_window(app)).await;
    if let Err(err) = &result {
        log::warn!("minimize_to_bubble: failed: {err}");
    }
    result
}

/// Called when the bubble's logo is clicked, to bring the main window back.
/// See `minimize_to_bubble`'s doc comment for why this runs via `run_on_main`.
#[tauri::command]
pub async fn restore_from_bubble(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("restore_from_bubble: invoked");
    let result = run_on_main(&app, |app| crate::bubble_window::restore_from_bubble(app)).await;
    if let Err(err) = &result {
        log::warn!("restore_from_bubble: failed: {err}");
    }
    result
}

/// Called from BubbleWidget.tsx once a press-and-move on the logo has
/// crossed the drag threshold. Goes through a dedicated command (rather than
/// the frontend calling the webview API's own `startDragging()` directly) so
/// a failure actually surfaces in these logs instead of silently doing
/// nothing — which is indistinguishable, from the user's side, from the drag
/// simply not being wired up at all.
#[tauri::command]
pub async fn drag_bubble_window(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("drag_bubble_window: invoked");
    let result = run_on_main(&app, |app| {
        let window = app
            .get_webview_window(crate::bubble_window::BUBBLE_WINDOW_LABEL)
            .ok_or_else(|| "bubble window not open".to_string())?;
        window.start_dragging().map_err(|e| e.to_string())
    })
    .await;
    if let Err(err) = &result {
        log::warn!("drag_bubble_window: failed: {err}");
    }
    result
}

/// Runs `f` on the main thread (required for window creation/show/hide on
/// Windows) and brings the result back to the calling async command via a
/// channel, so the IPC call completes normally instead of deadlocking. Same
/// helper `interview_mode::commands` keeps privately for its own overlay
/// window commands — duplicated here rather than shared across modules for
/// one function this small.
async fn run_on_main<T, F>(app: &tauri::AppHandle, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&tauri::AppHandle) -> Result<T, String> + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();
    let app_for_main = app.clone();
    app.run_on_main_thread(move || {
        let result = f(&app_for_main);
        let _ = tx.send(result);
    })
    .map_err(|e| format!("failed to schedule work on main thread: {e}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        rx.recv()
            .map_err(|e| format!("main-thread task did not respond: {e}"))?
    })
    .await
    .map_err(|e| format!("main-thread task panicked: {e}"))?
}
