//! Speaks a short test sentence through the default output device for the
//! pre-interview "Test Audio" check (see `src/AudioTest.tsx`).
//!
//! This is only the *signal source*: it makes the machine render real speech
//! to the default render endpoint, which is exactly what interview audio is
//! from the capture pipeline's point of view. Nothing here touches capture or
//! STT - the sentence still has to travel through WASAPI loopback and the
//! real Deepgram session before the check can pass, so a muted output, a wrong
//! default device, or a broken capture path all still fail it.
//!
//! On Windows, synthesis uses the built-in neural/OneCore voices (the same
//! ones Narrator uses) and playback uses `PlaySoundW` on the default device,
//! so no new dependency or child process is involved. On macOS the system's
//! own `say` and `afplay` tools do the same job.

use crate::state::AppState;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};
#[cfg(windows)]
use windows::core::{HSTRING, PCWSTR};
#[cfg(windows)]
use windows::Media::SpeechSynthesis::SpeechSynthesizer;
#[cfg(windows)]
use windows::Storage::Streams::DataReader;
#[cfg(windows)]
use windows::Win32::Media::Audio::{PlaySoundW, SND_MEMORY, SND_NODEFAULT, SND_PURGE, SND_SYNC};
use crate::crash_guard::LockExt;

const MAX_PHRASE_CHARS: usize = 160;

/// True while a test sentence is being played, so `stop_audio_test_phrase`
/// never purges some other sound.
static PLAYING: AtomicBool = AtomicBool::new(false);

/// The synthesized test sentence, ready to play. Synthesis takes a moment, so
/// the frontend prepares it while the STT session and capture are still
/// starting, and the sound begins the instant capture is live.
static PREPARED: Mutex<Option<Vec<u8>>> = Mutex::new(None);

/// Synthesizes `phrase` and holds it for `play_audio_test_phrase`.
#[tauri::command]
pub async fn prepare_audio_test_phrase(phrase: String) -> Result<(), String> {
    let phrase = phrase.trim().to_string();
    if phrase.is_empty() || phrase.chars().count() > MAX_PHRASE_CHARS {
        return Err("invalid test phrase".into());
    }
    let wav = tauri::async_runtime::spawn_blocking(move || synthesize_wav(&phrase))
        .await
        .map_err(|e| format!("test audio task failed: {e}"))?
        .map_err(|e| format!("could not prepare test audio: {e}"))?;
    *PREPARED.lock_safe() = Some(wav);
    Ok(())
}

/// Plays the prepared sentence and returns once it has finished (or been stopped).
#[tauri::command]
pub async fn play_audio_test_phrase() -> Result<(), String> {
    let wav = PREPARED
        .lock_safe()
        .take()
        .ok_or_else(|| "no test audio prepared".to_string())?;
    tauri::async_runtime::spawn_blocking(move || play_blocking(&wav))
        .await
        .map_err(|e| format!("test audio task failed: {e}"))?
}

/// Cuts off a test sentence still being spoken, so its tail can't be
/// transcribed into the interview that starts right after a cancelled test.
/// Safe to call at any time.
#[tauri::command]
pub fn stop_audio_test_phrase() {
    *PREPARED.lock_safe() = None;
    if PLAYING.load(Ordering::SeqCst) {
        stop_playback();
    }
}

#[cfg(windows)]
fn stop_playback() {
    unsafe {
        let _ = PlaySoundW(PCWSTR::null(), None, SND_PURGE);
    }
}

#[cfg(windows)]
fn synthesize_wav(phrase: &str) -> windows::core::Result<Vec<u8>> {
    let synthesizer = SpeechSynthesizer::new()?;
    let stream = synthesizer
        .SynthesizeTextToStreamAsync(&HSTRING::from(phrase))?
        .get()?;
    let size = stream.Size()? as u32;
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
    reader.LoadAsync(size)?.get()?;
    let mut wav = vec![0u8; size as usize];
    reader.ReadBytes(&mut wav)?;
    Ok(wav)
}

#[cfg(windows)]
fn play_blocking(wav: &[u8]) -> Result<(), String> {
    log::info!("audio test: speaking test phrase ({} bytes of speech)", wav.len());

    PLAYING.store(true, Ordering::SeqCst);
    // SND_SYNC: returns when playback ends (or is purged), which is what the
    // caller waits on. `wav` outlives the call.
    let played = unsafe { PlaySoundW(PCWSTR(wav.as_ptr() as *const u16), None, SND_MEMORY | SND_SYNC | SND_NODEFAULT) };
    PLAYING.store(false, Ordering::SeqCst);

    if played.as_bool() {
        Ok(())
    } else {
        // Also what a purge returns; the caller ignores the result once cancelled.
        Err("test audio could not be played".into())
    }
}

/// The running `afplay`, so `stop_playback` can cut it off.
#[cfg(target_os = "macos")]
static PLAYER: Mutex<Option<std::process::Child>> = Mutex::new(None);

#[cfg(target_os = "macos")]
fn temp_wav_path(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("smallbird-audio-test-{}-{name}.wav", std::process::id()))
}

#[cfg(target_os = "macos")]
fn stop_playback() {
    if let Some(mut child) = PLAYER.lock_safe().take() {
        let _ = child.kill();
    }
}

#[cfg(target_os = "macos")]
fn synthesize_wav(phrase: &str) -> Result<Vec<u8>, String> {
    let path = temp_wav_path("say");
    let status = std::process::Command::new("/usr/bin/say")
        .arg("-o")
        .arg(&path)
        .args(["--file-format=WAVE", "--data-format=LEI16@22050", "--"])
        .arg(phrase)
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("say exited with {status}"));
    }
    let wav = std::fs::read(&path).map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&path);
    wav
}

#[cfg(target_os = "macos")]
fn play_blocking(wav: &[u8]) -> Result<(), String> {
    log::info!("audio test: speaking test phrase ({} bytes of speech)", wav.len());

    let path = temp_wav_path("play");
    std::fs::write(&path, wav).map_err(|e| e.to_string())?;
    let child = std::process::Command::new("/usr/bin/afplay")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("test audio could not be played: {e}"))?;
    let pid = child.id();
    *PLAYER.lock_safe() = Some(child);
    PLAYING.store(true, Ordering::SeqCst);

    // Poll rather than wait() so `stop_playback` can take and kill the child
    // from another thread without this one holding the lock.
    let status = loop {
        let mut player = PLAYER.lock_safe();
        match player.as_mut() {
            Some(child) if child.id() == pid => match child.try_wait() {
                Ok(Some(status)) => {
                    player.take();
                    break Some(status);
                }
                Ok(None) => {}
                Err(_) => break None,
            },
            // Stopped (and killed) by `stop_playback`.
            _ => break None,
        }
        drop(player);
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    PLAYING.store(false, Ordering::SeqCst);
    let _ = std::fs::remove_file(&path);

    match status {
        Some(status) if status.success() => Ok(()),
        // Also what a stop returns; the caller ignores the result once cancelled.
        _ => Err("test audio could not be played".into()),
    }
}

// ---- Orphaned test sessions ------------------------------------------------
//
// A test needs a real STT session, and the server allows one active session
// per account. If the app dies mid-test (crash, force-quit, being killed
// while updating), that session stays "active" for a couple of minutes and
// the next test would be refused as if another device were in use. So the
// test's session id is written to disk while it runs; whoever starts next
// (the next test, or app launch) closes it. Only sessions the test itself
// created are ever recorded here - a real interview's session never is.

const PENDING_FILE: &str = "audio_test_session.json";
/// An orphan is billed for at most this long; it only ever ran a few seconds.
const MAX_ORPHAN_BILLED_SECONDS: u64 = 30;

#[derive(serde::Serialize, serde::Deserialize)]
struct PendingTestSession {
    session_id: String,
    started_at_ms: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn pending_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_local_data_dir().ok().map(|dir| dir.join(PENDING_FILE))
}

fn read_pending(path: &std::path::Path) -> Option<PendingTestSession> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// Records a freshly started test session so a crash can't strand it.
pub fn remember_test_session(app: &AppHandle, session_id: &str) {
    let Some(path) = pending_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let pending = PendingTestSession { session_id: session_id.to_string(), started_at_ms: now_ms() };
    if let Ok(json) = serde_json::to_string(&pending) {
        let _ = std::fs::write(path, json);
    }
}

/// Called when a session ends normally; drops the record if it was the test's.
pub fn forget_test_session(app: &AppHandle, session_id: &str) {
    let Some(path) = pending_path(app) else { return };
    if read_pending(&path).is_some_and(|p| p.session_id == session_id) {
        let _ = std::fs::remove_file(path);
    }
}

/// Closes a test session left behind by a run that never got to end it.
/// Safe to call any time: does nothing when there is no record, when the
/// record is the session this app is currently using, or when signed out.
#[tauri::command]
pub async fn close_orphaned_audio_test_session(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let Some(path) = pending_path(&app) else { return Ok(()) };
    let Some(pending) = read_pending(&path) else {
        let _ = std::fs::remove_file(&path); // unreadable record - don't keep retrying it
        return Ok(());
    };
    let in_use = state
        .stt_session
        .lock_safe()
        .as_ref()
        .is_some_and(|s| s.session_id == pending.session_id);
    if in_use {
        return Ok(());
    }

    let Ok(access_token) = crate::auth::current_access_token(&state).await else {
        return Ok(()); // signed out; try again next time
    };
    let seconds = (now_ms().saturating_sub(pending.started_at_ms) / 1000).clamp(1, MAX_ORPHAN_BILLED_SECONDS);
    match crate::stt::backend_token::report_usage(&access_token, &pending.session_id, seconds as f64).await {
        Ok(()) => {
            log::info!("audio test: closed orphaned test session left by an earlier run");
            let _ = std::fs::remove_file(&path);
        }
        Err(err) => log::warn!("audio test: could not close orphaned test session: {err}"),
    }
    Ok(())
}
