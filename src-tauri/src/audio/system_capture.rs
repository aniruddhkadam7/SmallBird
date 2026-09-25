use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crossbeam_channel::Sender;
use wasapi::{AudioCaptureClient, AudioClient, Direction, Handle, SampleType, StreamMode, WaveFormat};

use super::metrics::CaptureMetrics;
use super::resample::AudioResampler;
use super::{compute_rms, AudioChunk, AudioSource, StopSignal};

/// How long `start`/`start_with_metrics` will wait for the capture thread to
/// confirm WASAPI initialization before giving up. Generous relative to how
/// long device enumeration + `IAudioClient::Initialize` + `Start` normally
/// take (well under a second) — this exists to bound the wait if the thread
/// never gets to send at all (e.g. panics before reaching the send point),
/// not to accommodate a slow-but-working init.
const INIT_TIMEOUT: Duration = Duration::from_secs(10);

/// How often the capture loop checks whether Windows' default output device
/// changed (headphones plugged in, Bluetooth connected, output switched in
/// the volume flyout). Loopback taps one specific device, so after a switch
/// the old one just goes silent — there is no error to notice it by.
const DEFAULT_DEVICE_CHECK_INTERVAL: Duration = Duration::from_secs(2);

/// After the captured device disappears (unplugged, disabled, driver reset),
/// how long to keep trying to reopen on whatever becomes the new default
/// before giving up. Windows usually promotes the next device within a
/// second or two.
const DEVICE_RECOVERY_WINDOW: Duration = Duration::from_secs(10);
const DEVICE_RECOVERY_RETRY: Duration = Duration::from_millis(500);

type FailureHandler = Box<dyn Fn(String) + Send + Sync>;
static FAILURE_HANDLER: OnceLock<FailureHandler> = OnceLock::new();

/// Registers who to tell when capture stops mid-session for a reason it
/// couldn't recover from (see `lib.rs`, which forwards it to the UI). Init
/// failures aren't reported here — `start` already returns those to its
/// caller. First registration wins.
pub fn set_capture_failure_handler(handler: impl Fn(String) + Send + Sync + 'static) {
    let _ = FAILURE_HANDLER.set(Box::new(handler));
}

fn report_failure(message: String) {
    log::error!("system audio capture stopped: {message}");
    if let Some(handler) = FAILURE_HANDLER.get() {
        handler(message);
    }
}

/// Captures Windows system/output audio via WASAPI loopback on the default render
/// device. This works regardless of which application is producing sound (Chrome,
/// Edge, Teams, Zoom, Meet, ...) because it taps the shared mix, not any specific
/// app's output.
pub struct SystemAudioCapture;

impl SystemAudioCapture {
    /// Spawns a dedicated OS thread that captures loopback audio and pushes
    /// resampled 16kHz mono `AudioChunk`s onto `tx` until `stop` is signalled.
    ///
    /// Blocks (up to `INIT_TIMEOUT`) until the capture thread has confirmed
    /// WASAPI device enumeration + client init + `Start()` all succeeded, or
    /// returns the specific error if any of them failed. Earlier versions of
    /// this function returned as soon as the thread was merely *spawned*,
    /// which let a real-but-transient WASAPI init failure (a driver hiccup,
    /// a device busy/exclusive-mode conflict, no default render device) pass
    /// completely silently — the caller believed capture had started while
    /// the thread had actually already exited, so the UI reported
    /// "Recording" with zero audio ever flowing and no visible error. See
    /// `docs/performance-tuning.md`'s STT-start-reliability section.
    ///
    /// Once running, the thread follows the default output device: if it is
    /// switched or the captured one disappears, capture reopens on the new
    /// default. Only if that fails is the failure handler notified.
    pub fn start(
        tx: Sender<AudioChunk>,
        stop: StopSignal,
    ) -> Result<JoinHandle<()>, String> {
        Self::start_with_metrics(tx, stop, CaptureMetrics::new())
    }

    /// Same as `start`, but the caller keeps a handle on the pipeline counters.
    /// Used by the `audio_probe` binary to measure the real capture path; the
    /// normal `start` path allocates a throwaway handle so the counters cost
    /// the same either way.
    pub fn start_with_metrics(
        tx: Sender<AudioChunk>,
        stop: StopSignal,
        metrics: Arc<CaptureMetrics>,
    ) -> Result<JoinHandle<()>, String> {
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let handle = std::thread::Builder::new()
            .name("system-audio-capture".into())
            .spawn(move || {
                let started = AtomicBool::new(false);
                let thread_stop = stop.clone();
                // Guarded so a panic mid-session is reported like any other
                // failure rather than capture silently vanishing.
                let result = crate::crash_guard::guard("system audio capture", || {
                    run_capture_loop(tx, thread_stop, metrics, ready_tx, &started)
                });
                if let Err(err) = result {
                    // Init failures are returned to `start`'s caller instead;
                    // a stop the user asked for is not a failure.
                    if started.load(Ordering::Relaxed) && !stop.is_stopped() {
                        report_failure(err);
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        match ready_rx.recv_timeout(INIT_TIMEOUT) {
            Ok(Ok(())) => Ok(handle),
            Ok(Err(err)) => {
                // The thread already returned (init failed before the
                // capture loop starts) — join it to avoid leaking the
                // handle, then surface the real error to the caller instead
                // of a fake success.
                let _ = handle.join();
                Err(err)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                // The thread ended without reporting either way — it
                // panicked during init (already recorded by the panic hook).
                let _ = handle.join();
                Err("system audio capture failed while starting".to_string())
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // Timed out waiting — the thread never reached the send
                // point (hung). Don't block the caller forever; report a
                // clear, actionable timeout instead of silently returning
                // "started".
                Err("system audio capture did not initialize in time".to_string())
            }
        }
    }
}

/// One open loopback stream on a specific output device.
struct LoopbackStream {
    audio_client: AudioClient,
    capture_client: AudioCaptureClient,
    event_handle: Handle,
    in_rate: usize,
    in_channels: usize,
    device_id: Option<String>,
}

impl Drop for LoopbackStream {
    fn drop(&mut self) {
        let _ = self.audio_client.stop_stream();
    }
}

fn default_render_device_id() -> Option<String> {
    wasapi::DeviceEnumerator::new()
        .ok()?
        .get_default_device(&Direction::Render)
        .ok()?
        .get_id()
        .ok()
}

fn open_default_loopback() -> Result<LoopbackStream, String> {
    let enumerator = wasapi::DeviceEnumerator::new().map_err(|e| e.to_string())?;
    let device = enumerator
        .get_default_device(&Direction::Render)
        .map_err(|e| format!("no default output device: {e}"))?;
    let device_id = device.get_id().ok();

    let mut audio_client = device.get_iaudioclient().map_err(|e| e.to_string())?;
    let mix_format = audio_client.get_mixformat().map_err(|e| e.to_string())?;
    let in_rate = mix_format.get_samplespersec() as usize;
    let in_channels = mix_format.get_nchannels() as usize;

    // Request float samples at the device's native mix format; WASAPI shared-mode
    // loopback requires matching the mix format (autoconvert handles edge cases).
    let desired_format = WaveFormat::new(32, 32, &SampleType::Float, in_rate, in_channels, None);

    let buffer_duration_hns = 200_000; // 20ms
    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns,
    };

    audio_client
        .initialize_client(&desired_format, &Direction::Capture, &mode)
        .map_err(|e| format!("failed to initialize loopback client: {e}"))?;

    let event_handle = audio_client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let capture_client = audio_client.get_audiocaptureclient().map_err(|e| e.to_string())?;

    audio_client.start_stream().map_err(|e| e.to_string())?;

    log::info!(
        "system audio loopback started: {in_rate} Hz, {in_channels} ch -> {} Hz mono",
        super::TARGET_SAMPLE_RATE
    );

    Ok(LoopbackStream {
        audio_client,
        capture_client,
        event_handle,
        in_rate,
        in_channels,
        device_id,
    })
}

/// Why `pump` returned.
enum PumpEnd {
    Stopped,
    /// The captured device stopped working (unplugged/disabled/driver reset).
    DeviceLost(String),
    /// Windows now routes output to a different device.
    DefaultChanged,
}

fn run_capture_loop(
    tx: Sender<AudioChunk>,
    stop: StopSignal,
    metrics: Arc<CaptureMetrics>,
    ready_tx: mpsc::Sender<Result<(), String>>,
    started: &AtomicBool,
) -> Result<(), String> {
    let first = wasapi::initialize_mta()
        .ok()
        .map_err(|e| e.to_string())
        .and_then(|()| open_default_loopback());

    let mut stream = match first {
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

    let mut byte_buf: Vec<u8> = Vec::new();

    loop {
        match pump(&stream, &tx, &stop, &metrics, &mut byte_buf) {
            PumpEnd::Stopped => break,
            PumpEnd::DefaultChanged => match open_default_loopback() {
                Ok(new_stream) => {
                    log::info!("default output device changed; capture moved to the new device");
                    stream = new_stream;
                }
                // The old device still works — keep capturing it and try
                // again at the next check.
                Err(err) => log::warn!("default output device changed but couldn't be opened yet: {err}"),
            },
            PumpEnd::DeviceLost(reason) => {
                log::warn!("output device lost ({reason}); reopening on the current default");
                drop(stream);
                match reopen_with_retry(&stop) {
                    Some(new_stream) => stream = new_stream,
                    None if stop.is_stopped() => {
                        log::info!("system audio loopback stopped");
                        return Ok(());
                    }
                    None => {
                        return Err(format!(
                            "the audio output device was disconnected ({reason}) and no other output device became available"
                        ))
                    }
                }
            }
        }
    }

    log::info!("system audio loopback stopped");
    Ok(())
}

fn reopen_with_retry(stop: &StopSignal) -> Option<LoopbackStream> {
    let deadline = Instant::now() + DEVICE_RECOVERY_WINDOW;
    while !stop.is_stopped() && Instant::now() < deadline {
        match open_default_loopback() {
            Ok(stream) => return Some(stream),
            Err(err) => log::debug!("reopen attempt failed: {err}"),
        }
        std::thread::sleep(DEVICE_RECOVERY_RETRY);
    }
    None
}

/// Moves audio from `stream` to `tx` until stopped or the device situation
/// changes. Event waits time out routinely (loopback only signals while
/// something is actually playing), so a timeout is never treated as failure.
fn pump(
    stream: &LoopbackStream,
    tx: &Sender<AudioChunk>,
    stop: &StopSignal,
    metrics: &CaptureMetrics,
    byte_buf: &mut Vec<u8>,
) -> PumpEnd {
    let mut resampler = AudioResampler::new(stream.in_rate as u32, stream.in_channels as u16);
    let bytes_per_frame = stream.in_channels * 4; // 32-bit float
    let mut last_device_check = Instant::now();

    while !stop.is_stopped() {
        if last_device_check.elapsed() >= DEFAULT_DEVICE_CHECK_INTERVAL {
            last_device_check = Instant::now();
            if let (Some(current), Some(ours)) = (default_render_device_id(), stream.device_id.as_ref()) {
                if &current != ours {
                    return PumpEnd::DefaultChanged;
                }
            }
        }

        if stream.event_handle.wait_for_event(200).is_err() {
            continue;
        }

        loop {
            let packet_frames = match stream.capture_client.get_next_packet_size() {
                Ok(Some(frames)) => frames,
                Ok(None) => break,
                // Previously a `break` back to waiting, which after an
                // unplug spun forever capturing nothing.
                Err(err) => return PumpEnd::DeviceLost(err.to_string()),
            };
            if packet_frames == 0 {
                break;
            }

            byte_buf.resize(packet_frames as usize * bytes_per_frame, 0);
            let (frames_read, buffer_info) = match stream.capture_client.read_from_device(byte_buf) {
                Ok(read) => read,
                Err(err) => return PumpEnd::DeviceLost(err.to_string()),
            };
            if frames_read == 0 {
                break;
            }

            metrics.packets.fetch_add(1, Ordering::Relaxed);
            metrics
                .frames_in
                .fetch_add(frames_read as u64, Ordering::Relaxed);
            if buffer_info.flags.data_discontinuity {
                // The device buffer overflowed and audio was lost before we
                // read it. This is the definitive dropped-audio signal.
                metrics.discontinuities.fetch_add(1, Ordering::Relaxed);
            }
            if buffer_info.flags.timestamp_error {
                metrics.timestamp_errors.fetch_add(1, Ordering::Relaxed);
            }

            let resample_started = Instant::now();
            let mono_resampled = if buffer_info.flags.silent {
                metrics.silent_packets.fetch_add(1, Ordering::Relaxed);
                let mono_len = frames_read as usize;
                resampler.process(&vec![0.0f32; mono_len * stream.in_channels])
            } else {
                // Clamped to what the buffer actually holds, so a driver
                // reporting more frames than it wrote can't panic the slice.
                let sample_count = (frames_read as usize * stream.in_channels).min(byte_buf.len() / 4);
                let interleaved: Vec<f32> = byte_buf[..sample_count * 4]
                    .chunks_exact(4)
                    .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                    .collect();
                resampler.process(&interleaved)
            };
            metrics
                .resample_micros
                .fetch_add(resample_started.elapsed().as_micros() as u64, Ordering::Relaxed);

            if mono_resampled.is_empty() {
                metrics.empty_chunks.fetch_add(1, Ordering::Relaxed);
            } else {
                metrics
                    .samples_emitted
                    .fetch_add(mono_resampled.len() as u64, Ordering::Relaxed);
            }
            emit_chunk(tx, mono_resampled);
        }
    }

    PumpEnd::Stopped
}

fn emit_chunk(tx: &Sender<AudioChunk>, samples: Vec<f32>) {
    if samples.is_empty() {
        return;
    }
    let rms_level = compute_rms(&samples);
    let _ = tx.send(AudioChunk {
        source: AudioSource::SystemAudio,
        samples,
        rms_level,
    });
}
