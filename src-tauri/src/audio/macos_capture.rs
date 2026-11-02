//! macOS capture backend for `system_capture` — Core Audio through cpal.
//!
//! - Microphone: a plain input stream on the default input device.
//! - System audio: an input stream built on the default *output* device,
//!   which cpal turns into a Core Audio process tap + private aggregate
//!   device (macOS 14.6+). Like WASAPI loopback it taps the shared output
//!   mix, so it hears Zoom/Meet/Teams/browsers alike. The first use asks the
//!   user for "System Audio Recording" permission (NSAudioCaptureUsageDescription
//!   in Info.plist); the microphone asks for microphone permission.
//!
//! Mirrors the Windows backend's contract: report init success/failure on
//! `ready_tx`, follow the default device when it changes, reopen after the
//! captured device disappears, and only give up after `DEVICE_RECOVERY_WINDOW`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use crossbeam_channel::{Receiver, RecvTimeoutError, Sender};

use super::super::metrics::CaptureMetrics;
use super::super::resample::AudioResampler;
use super::super::{AudioChunk, StopSignal};
use super::{
    emit_chunk, CaptureKind, DEFAULT_DEVICE_CHECK_INTERVAL, DEVICE_RECOVERY_RETRY, DEVICE_RECOVERY_WINDOW,
};

/// One open Core Audio stream plus the channel its callback feeds.
struct CoreAudioStream {
    // Dropping the stream stops it (and, for loopback, tears down the tap's
    // aggregate device).
    _stream: cpal::Stream,
    samples: Receiver<Vec<f32>>,
    /// Set by the stream's error callback when the device stops working.
    lost: Arc<AtomicBool>,
    in_rate: u32,
    in_channels: u16,
    device_id: Option<String>,
}

fn default_device(kind: CaptureKind) -> Option<cpal::Device> {
    let host = cpal::default_host();
    match kind {
        CaptureKind::Loopback => host.default_output_device(),
        CaptureKind::Microphone => host.default_input_device(),
    }
}

fn default_device_id(kind: CaptureKind) -> Option<String> {
    default_device(kind)?.id().ok().map(|id| id.to_string())
}

fn open_default(kind: CaptureKind) -> Result<CoreAudioStream, String> {
    let device = default_device(kind).ok_or_else(|| match kind {
        CaptureKind::Loopback => "no default output device".to_string(),
        CaptureKind::Microphone => "no microphone found".to_string(),
    })?;
    let device_id = device.id().ok().map(|id| id.to_string());

    let config = match kind {
        CaptureKind::Loopback => device.default_output_config(),
        CaptureKind::Microphone => device.default_input_config(),
    }
    .map_err(|e| e.to_string())?;
    let in_rate = config.sample_rate();
    let in_channels = config.channels();

    // Unbounded so the real-time callback never blocks; the capture thread
    // drains it continuously.
    let (samples_tx, samples_rx): (Sender<Vec<f32>>, Receiver<Vec<f32>>) = crossbeam_channel::unbounded();
    let lost = Arc::new(AtomicBool::new(false));
    let lost_cb = lost.clone();

    // Core Audio converts to f32 at the device's own rate/channel layout.
    let stream = device
        .build_input_stream::<f32, _, _>(
            config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let _ = samples_tx.send(data.to_vec());
            },
            move |err: cpal::Error| match err.kind() {
                cpal::ErrorKind::Xrun | cpal::ErrorKind::RealtimeDenied => {
                    log::debug!("{} stream: {err}", kind.label())
                }
                _ => {
                    log::warn!("{} stream error: {err}", kind.label());
                    lost_cb.store(true, Ordering::Relaxed);
                }
            },
            None,
        )
        .map_err(|e| match kind {
            CaptureKind::Loopback => format!(
                "couldn't start system audio capture ({e}) — it needs macOS 14.6 or later and \
                 System Settings > Privacy & Security > Screen & System Audio Recording access"
            ),
            CaptureKind::Microphone => format!(
                "couldn't open the microphone ({e}) — check System Settings > Privacy & Security > Microphone"
            ),
        })?;
    stream.play().map_err(|e| e.to_string())?;

    log::info!(
        "{} capture started: {in_rate} Hz, {in_channels} ch -> {} Hz mono",
        kind.label(),
        super::super::TARGET_SAMPLE_RATE
    );

    Ok(CoreAudioStream { _stream: stream, samples: samples_rx, lost, in_rate, in_channels, device_id })
}

enum PumpEnd {
    Stopped,
    DeviceLost(String),
    DefaultChanged,
}

pub(super) fn run_capture_loop(
    kind: CaptureKind,
    tx: Sender<AudioChunk>,
    stop: StopSignal,
    metrics: Arc<CaptureMetrics>,
    ready_tx: mpsc::Sender<Result<(), String>>,
    started: &AtomicBool,
) -> Result<(), String> {
    let mut stream = match open_default(kind) {
        Ok(stream) => {
            started.store(true, Ordering::Relaxed);
            let _ = ready_tx.send(Ok(()));
            stream
        }
        Err(err) => {
            let _ = ready_tx.send(Err(err.clone()));
            return Err(err);
        }
    };

    loop {
        match pump(kind, &stream, &tx, &stop, &metrics) {
            PumpEnd::Stopped => break,
            PumpEnd::DefaultChanged => match open_default(kind) {
                Ok(new_stream) => {
                    log::info!("default {} device changed; capture moved to the new device", kind.label());
                    stream = new_stream;
                }
                Err(err) => log::warn!("default {} device changed but couldn't be opened yet: {err}", kind.label()),
            },
            PumpEnd::DeviceLost(reason) => {
                log::warn!("{} device lost ({reason}); reopening on the current default", kind.label());
                drop(stream);
                match reopen_with_retry(kind, &stop) {
                    Some(new_stream) => stream = new_stream,
                    None if stop.is_stopped() => {
                        log::info!("{} capture stopped", kind.label());
                        return Ok(());
                    }
                    None => {
                        return Err(match kind {
                            CaptureKind::Loopback => format!(
                                "the audio output device was disconnected ({reason}) and no other output device became available"
                            ),
                            CaptureKind::Microphone => format!(
                                "the microphone was disconnected ({reason}) and no other microphone became available"
                            ),
                        })
                    }
                }
            }
        }
    }

    log::info!("{} capture stopped", kind.label());
    Ok(())
}

fn reopen_with_retry(kind: CaptureKind, stop: &StopSignal) -> Option<CoreAudioStream> {
    let deadline = Instant::now() + DEVICE_RECOVERY_WINDOW;
    while !stop.is_stopped() && Instant::now() < deadline {
        match open_default(kind) {
            Ok(stream) => return Some(stream),
            Err(err) => log::debug!("reopen attempt failed: {err}"),
        }
        std::thread::sleep(DEVICE_RECOVERY_RETRY);
    }
    None
}

fn pump(
    kind: CaptureKind,
    stream: &CoreAudioStream,
    tx: &Sender<AudioChunk>,
    stop: &StopSignal,
    metrics: &CaptureMetrics,
) -> PumpEnd {
    let mut resampler = AudioResampler::new(stream.in_rate, stream.in_channels);
    let mut last_device_check = Instant::now();

    while !stop.is_stopped() {
        if stream.lost.load(Ordering::Relaxed) {
            return PumpEnd::DeviceLost("the device stopped responding".into());
        }
        if last_device_check.elapsed() >= DEFAULT_DEVICE_CHECK_INTERVAL {
            last_device_check = Instant::now();
            if let (Some(current), Some(ours)) = (default_device_id(kind), stream.device_id.as_ref()) {
                if &current != ours {
                    return PumpEnd::DefaultChanged;
                }
            }
        }

        let interleaved = match stream.samples.recv_timeout(Duration::from_millis(200)) {
            Ok(data) => data,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => return PumpEnd::DeviceLost("the stream ended".into()),
        };

        let frames = interleaved.len() / stream.in_channels.max(1) as usize;
        metrics.packets.fetch_add(1, Ordering::Relaxed);
        metrics.frames_in.fetch_add(frames as u64, Ordering::Relaxed);

        let resample_started = Instant::now();
        let mono_resampled = resampler.process(&interleaved);
        metrics
            .resample_micros
            .fetch_add(resample_started.elapsed().as_micros() as u64, Ordering::Relaxed);

        if mono_resampled.is_empty() {
            metrics.empty_chunks.fetch_add(1, Ordering::Relaxed);
        } else {
            metrics.samples_emitted.fetch_add(mono_resampled.len() as u64, Ordering::Relaxed);
        }
        emit_chunk(tx, kind.source(), mono_resampled);
    }

    PumpEnd::Stopped
}
