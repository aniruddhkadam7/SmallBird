//! `SttClient`: streams microphone/system audio to Deepgram Flux
//! (`wss://api.deepgram.com/v2/listen`) and turns its turn-based transcript
//! events into this crate's `SttEvent` stream.
//!
//! The public surface (`spawn`/`send_samples`/`flush`/`shutdown`) is
//! deliberately synchronous and shaped exactly like the old local-sidecar
//! client it replaces, so `audio::pipeline::run_stt_pipeline` — which runs on
//! a plain OS thread, not an async task — barely changed. Internally, `spawn`
//! starts a `tauri::async_runtime` task that owns the actual WebSocket
//! connection; the sync side talks to it over a
//! `tokio::sync::mpsc::UnboundedSender`, whose `send()` is a plain
//! non-blocking sync call, so no bridging thread is needed.

use std::sync::mpsc::{self, Receiver, Sender};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::UnboundedSender;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;

use crate::audio::AudioSource;

use super::events::{SttEvent, SttEventKind};

const DEEPGRAM_WS_URL: &str =
    "wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000";

/// How long `SttClient::spawn` waits for Deepgram's `Connected` message
/// before giving up — mirrors the old sidecar's `STT_READY_TIMEOUT_MS`
/// readiness gate (see `commands::start_capture_inner`'s doc comment for why
/// audio capture must not start until this resolves).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// How long `shutdown()` waits for the async task to confirm it has sent
/// `CloseStream` and torn down the connection before giving up and returning
/// anyway — bounded so a stuck network path can never hang the Stop command.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);

/// 80ms of 16kHz mono PCM16 — Deepgram's documented recommended chunk size
/// for Flux. Smaller WASAPI-driven chunks (typically ~20ms) are buffered up
/// to this size before being sent as one binary WS frame.
const FRAME_SAMPLES: usize = 1280;

enum OutboundMsg {
    Audio(Vec<u8>),
    ForceEndTurn,
    Close,
}

pub struct SttClient {
    outbound_tx: UnboundedSender<OutboundMsg>,
    done_rx: Receiver<()>,
    /// Accumulates PCM16 bytes until a full ~80ms frame is ready to send —
    /// see `FRAME_SAMPLES`.
    pcm_buffer: Vec<u8>,
}

impl SttClient {
    /// Connects to Deepgram Flux and blocks (up to `CONNECT_TIMEOUT`) until
    /// the `Connected` message arrives, an error/close happens first, or the
    /// timeout elapses — the same "confirmed ready before audio capture
    /// starts" contract the old sidecar's `spawn` provided.
    ///
    /// `app`: used to emit `"stt:error"` if the connection drops later and
    /// bounded reconnect attempts are exhausted, so the frontend can show a
    /// real "transcription disconnected" state instead of silently going
    /// quiet. `None` for the headless `bin/pipeline_test*.rs` binaries,
    /// which have no `AppHandle` — a permanent disconnect there is simply
    /// logged instead.
    pub fn spawn(
        source: AudioSource,
        events_tx: Sender<SttEvent>,
        api_key: String,
        app: Option<AppHandle>,
    ) -> Result<Self, String> {
        let (outbound_tx, outbound_rx) = tokio::sync::mpsc::unbounded_channel::<OutboundMsg>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let (done_tx, done_rx) = mpsc::channel::<()>();

        tauri::async_runtime::spawn(async move {
            run_connection(source, events_tx, outbound_rx, ready_tx, api_key, app).await;
            let _ = done_tx.send(());
        });

        match ready_rx.recv_timeout(CONNECT_TIMEOUT) {
            Ok(Ok(())) => {}
            Ok(Err(message)) => return Err(format!("Deepgram connection failed: {message}")),
            Err(_) => return Err("Deepgram did not confirm connection in time".to_string()),
        }

        Ok(Self {
            outbound_tx,
            done_rx,
            pcm_buffer: Vec::with_capacity(FRAME_SAMPLES * 2),
        })
    }

    /// Encodes f32 samples (range -1.0..1.0) as PCM16 and queues them,
    /// batching into ~80ms frames before handing each off to the WS task.
    pub fn send_samples(&mut self, samples: &[f32]) -> Result<(), String> {
        for &s in samples {
            let clamped = s.clamp(-1.0, 1.0);
            let sample_i16 = (clamped * i16::MAX as f32) as i16;
            self.pcm_buffer.extend_from_slice(&sample_i16.to_le_bytes());
        }

        let frame_bytes = FRAME_SAMPLES * 2;
        while self.pcm_buffer.len() >= frame_bytes {
            let frame: Vec<u8> = self.pcm_buffer.drain(..frame_bytes).collect();
            self.outbound_tx
                .send(OutboundMsg::Audio(frame))
                .map_err(|_| "Deepgram connection task has ended".to_string())?;
        }
        Ok(())
    }

    /// Flushes any buffered partial frame, then asks Deepgram to end the
    /// current turn immediately — used when the user pauses/stops recording,
    /// replacing the old sidecar's zero-length-frame flush marker.
    pub fn flush(&mut self) -> Result<(), String> {
        if !self.pcm_buffer.is_empty() {
            let frame: Vec<u8> = self.pcm_buffer.drain(..).collect();
            self.outbound_tx
                .send(OutboundMsg::Audio(frame))
                .map_err(|_| "Deepgram connection task has ended".to_string())?;
        }
        self.outbound_tx
            .send(OutboundMsg::ForceEndTurn)
            .map_err(|_| "Deepgram connection task has ended".to_string())
    }

    /// Sends `CloseStream` and waits (up to `SHUTDOWN_TIMEOUT`) for the
    /// connection task to confirm it has torn the WebSocket down cleanly.
    pub fn shutdown(self) {
        let _ = self.outbound_tx.send(OutboundMsg::Close);
        let _ = self.done_rx.recv_timeout(SHUTDOWN_TIMEOUT);
    }
}

/// Bounded reconnect budget for an unexpected disconnect (network blip,
/// Deepgram-side error) — never retried on an intentional `Close`.
const MAX_RECONNECT_ATTEMPTS: u32 = 2;
const RECONNECT_BACKOFF: Duration = Duration::from_millis(500);

async fn run_connection(
    source: AudioSource,
    events_tx: Sender<SttEvent>,
    mut outbound_rx: tokio::sync::mpsc::UnboundedReceiver<OutboundMsg>,
    ready_tx: mpsc::Sender<Result<(), String>>,
    api_key: String,
    app: Option<AppHandle>,
) {
    let mut ready_tx = Some(ready_tx);
    let mut attempt = 0u32;

    loop {
        match connect_and_pump(source, &events_tx, &mut outbound_rx, &api_key, ready_tx.take()).await {
            ConnectionOutcome::ClosedIntentionally => return,
            ConnectionOutcome::Failed(err) => {
                if attempt >= MAX_RECONNECT_ATTEMPTS {
                    log::error!("Deepgram STT connection failed permanently: {err}");
                    if let Some(app) = &app {
                        let _ = app.emit("stt:error", format!("Transcription disconnected: {err}"));
                    }
                    return;
                }
                attempt += 1;
                log::warn!(
                    "Deepgram STT connection dropped ({err}); reconnecting (attempt {attempt}/{MAX_RECONNECT_ATTEMPTS})"
                );
                tokio::time::sleep(RECONNECT_BACKOFF).await;
            }
        }
    }
}

enum ConnectionOutcome {
    ClosedIntentionally,
    Failed(String),
}

async fn connect_and_pump(
    source: AudioSource,
    events_tx: &Sender<SttEvent>,
    outbound_rx: &mut tokio::sync::mpsc::UnboundedReceiver<OutboundMsg>,
    api_key: &str,
    ready_tx: Option<mpsc::Sender<Result<(), String>>>,
) -> ConnectionOutcome {
    let mut request = match DEEPGRAM_WS_URL.into_client_request() {
        Ok(r) => r,
        Err(err) => {
            if let Some(tx) = ready_tx {
                let _ = tx.send(Err(err.to_string()));
            }
            return ConnectionOutcome::Failed(err.to_string());
        }
    };
    let auth_value = match HeaderValue::from_str(&format!("Token {api_key}")) {
        Ok(v) => v,
        Err(err) => {
            if let Some(tx) = ready_tx {
                let _ = tx.send(Err(err.to_string()));
            }
            return ConnectionOutcome::Failed(err.to_string());
        }
    };
    request.headers_mut().insert("Authorization", auth_value);

    let (ws_stream, _response) = match tokio_tungstenite::connect_async(request).await {
        Ok(pair) => pair,
        Err(err) => {
            if let Some(tx) = ready_tx {
                let _ = tx.send(Err(err.to_string()));
            }
            return ConnectionOutcome::Failed(err.to_string());
        }
    };
    let (mut ws_write, mut ws_read) = ws_stream.split();

    // Wait for Deepgram's `Connected` message before reporting ready — same
    // "confirmed, not assumed" contract the old sidecar's ready handshake had.
    let mut ready_tx = ready_tx;
    loop {
        match ws_read.next().await {
            Some(Ok(Message::Text(text))) => match serde_json::from_str::<ServerMessage>(&text) {
                Ok(ServerMessage::Connected { .. }) => {
                    if let Some(tx) = ready_tx.take() {
                        let _ = tx.send(Ok(()));
                    }
                    break;
                }
                Ok(ServerMessage::FatalError { code, description }) => {
                    let msg = format!("{code}: {description}");
                    if let Some(tx) = ready_tx {
                        let _ = tx.send(Err(msg.clone()));
                    }
                    return ConnectionOutcome::Failed(msg);
                }
                _ => continue,
            },
            Some(Ok(_)) => continue,
            Some(Err(err)) => {
                if let Some(tx) = ready_tx {
                    let _ = tx.send(Err(err.to_string()));
                }
                return ConnectionOutcome::Failed(err.to_string());
            }
            None => {
                let err = "connection closed before Deepgram confirmed ready".to_string();
                if let Some(tx) = ready_tx {
                    let _ = tx.send(Err(err.clone()));
                }
                return ConnectionOutcome::Failed(err);
            }
        }
    }

    // Main pump: forward outbound audio/control messages, forward inbound
    // transcript events, until an intentional Close or an error/disconnect.
    loop {
        tokio::select! {
            outbound = outbound_rx.recv() => {
                match outbound {
                    Some(OutboundMsg::Audio(bytes)) => {
                        if let Err(err) = ws_write.send(Message::Binary(bytes)).await {
                            return ConnectionOutcome::Failed(err.to_string());
                        }
                    }
                    Some(OutboundMsg::ForceEndTurn) => {
                        if let Err(err) = ws_write.send(Message::Text(r#"{"type":"ForceEndTurn"}"#.to_string())).await {
                            return ConnectionOutcome::Failed(err.to_string());
                        }
                    }
                    Some(OutboundMsg::Close) | None => {
                        let _ = ws_write.send(Message::Text(r#"{"type":"CloseStream"}"#.to_string())).await;
                        let _ = ws_write.close().await;
                        return ConnectionOutcome::ClosedIntentionally;
                    }
                }
            }
            incoming = ws_read.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        handle_server_message(&text, source, events_tx);
                    }
                    Some(Ok(Message::Close(_))) => {
                        return ConnectionOutcome::Failed("server closed the connection".to_string());
                    }
                    Some(Ok(_)) => {}
                    Some(Err(err)) => {
                        return ConnectionOutcome::Failed(err.to_string());
                    }
                    None => {
                        return ConnectionOutcome::Failed("connection stream ended unexpectedly".to_string());
                    }
                }
            }
        }
    }
}

fn handle_server_message(text: &str, source: AudioSource, events_tx: &Sender<SttEvent>) {
    match serde_json::from_str::<ServerMessage>(text) {
        Ok(ServerMessage::TurnInfo {
            event,
            transcript,
            audio_window_start,
            audio_window_end,
            ..
        }) => match event.as_str() {
            "Update" => {
                let _ = events_tx.send(SttEvent {
                    kind: SttEventKind::Partial,
                    text: transcript,
                    source,
                    start_time: None,
                    end_time: None,
                });
            }
            "EndOfTurn" => {
                let _ = events_tx.send(SttEvent {
                    kind: SttEventKind::Final,
                    text: transcript,
                    source,
                    start_time: audio_window_start,
                    end_time: audio_window_end,
                });
            }
            // StartOfTurn carries no text yet; EagerEndOfTurn/TurnResumed only
            // fire when `eager_eot_threshold` is configured, which it isn't
            // (see module doc) — intentionally unhandled for now.
            other => {
                log::debug!("Deepgram STT: unhandled TurnInfo event kind {other:?}: {text}");
            }
        },
        Ok(ServerMessage::Connected { .. }) => {
            // Only expected during the initial handshake in `connect_and_pump`;
            // harmless if it somehow arrives again later.
        }
        Ok(ServerMessage::FatalError { code, description }) => {
            log::error!("Deepgram STT error: {code}: {description}");
        }
        Ok(ServerMessage::Other) => {
            log::debug!("Deepgram STT: unrecognized message type: {text}");
        }
        Err(err) => {
            // A silent catch-all here previously meant a wire-format mismatch
            // (e.g. a field typed wrong) would drop every single event with
            // no visible symptom beyond "transcription just doesn't happen" —
            // logged at warn so it's visible without needing STT_DIAG/debug
            // logging enabled.
            log::warn!("Deepgram STT: failed to parse server message ({err}): {text}");
        }
    }
}

/// Accepts either a JSON number or a numeric JSON string for a field —
/// Deepgram's own docs are inconsistent about whether `audio_window_start`/
/// `audio_window_end` are quoted, so this tolerates either wire format
/// rather than silently dropping every `TurnInfo` message if the assumption
/// is wrong.
fn de_flexible_f64<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;

    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum Flexible {
        Number(f64),
        Text(String),
        Null,
    }
    Ok(match Option::<Flexible>::deserialize(deserializer)? {
        Some(Flexible::Number(n)) => Some(n),
        Some(Flexible::Text(s)) => s.parse().ok(),
        Some(Flexible::Null) | None => None,
    })
}

/// Subset of Deepgram Flux's server → client JSON messages this client
/// actually acts on. `Other` (and any unrecognized `type`) is a deliberate
/// catch-all — `ConfigureSuccess`/`ConfigureFailure` and any future message
/// types are simply ignored rather than treated as parse errors.
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "type")]
enum ServerMessage {
    Connected {
        #[serde(default)]
        #[allow(dead_code)]
        request_id: Option<String>,
    },
    TurnInfo {
        event: String,
        #[serde(default)]
        transcript: String,
        #[serde(default, deserialize_with = "de_flexible_f64")]
        audio_window_start: Option<f64>,
        #[serde(default, deserialize_with = "de_flexible_f64")]
        audio_window_end: Option<f64>,
    },
    #[serde(rename = "Error")]
    FatalError {
        code: String,
        description: String,
    },
    #[serde(other)]
    Other,
}
