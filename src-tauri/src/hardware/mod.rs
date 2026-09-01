//! Hardware detection and performance-mode preference tracking. See
//! docs/performance-tuning.md (once Milestone 7 lands) for the historical
//! benchmark evidence behind `manager.rs`'s tier table (largely
//! superseded now that STT is a Deepgram cloud connection rather than a
//! locally-sized thread pool, and RAG search has been removed entirely —
//! see `manager.rs`'s module doc). Smallbird's LLM is a cloud API call —
//! not touched here, and never hardware-tiered.

pub mod commands;
pub mod fingerprint;
pub mod gpu;
pub mod manager;
pub mod pressure;
pub mod profile;
pub mod storage;
pub mod store;
pub mod telemetry;
pub mod tier;

use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use manager::PerformanceManager;
use profile::CpuUsageSampler;

/// Tauri-managed state wrapping the single `PerformanceManager` instance —
/// registered directly via `.manage(...)`, following the same top-level
/// state pattern as `NotesStore`/`AgentStore`, rather than nesting inside
/// `AppState`. `Mutex`-wrapped because Tauri commands run on arbitrary
/// threads. `cpu_sampler` lives alongside the manager rather than inside
/// its `Mutex` — it only ever needs a non-blocking atomic read (see
/// `CpuUsageSampler::latest_percent`), so it doesn't need the same lock.
pub struct PerformanceState(pub Mutex<PerformanceManager>, pub CpuUsageSampler);

/// Detects hardware and loads the persisted mode preference. Called once
/// from `lib.rs`'s `.setup()`, since loading the persisted mode needs an
/// `AppHandle` (to resolve the app data directory) that isn't available at
/// `.manage()` time.
///
/// The hardware profile itself is always freshly detected (never cached
/// across launches — see `profile::detect`'s doc). What CAN otherwise go
/// stale is the persisted *mode* preference: an explicit `MaximumPerformance`/
/// `BatterySaver` choice is only trustworthy on the machine it was chosen
/// on, so it's tagged with a hardware fingerprint (`fingerprint::compute`)
/// and `store::load` resets it back to `Adaptive` if this launch's
/// fingerprint doesn't match — see `store.rs`'s module doc for the full
/// reconciliation rules (same machine / different machine / missing
/// fingerprint migration / corrupted file).
pub fn init(app: &AppHandle) -> PerformanceState {
    let profile = profile::detect();
    let current_fingerprint = fingerprint::compute(&profile);
    let loaded = store::load(app, &current_fingerprint);
    log::info!(
        "hardware profile: {} logical cores, {}MB RAM, gpu={:?}, ssd={:?}",
        profile.cpu_logical_cores,
        profile.total_ram_mb,
        profile.gpu_name,
        profile.storage_is_ssd
    );
    if loaded.hardware_changed {
        log::info!(
            "hardware fingerprint changed since performance.json was last written — \
             this looks like a different physical machine; resetting performance mode \
             to Adaptive rather than reusing an override chosen on other hardware"
        );
    }
    let mut manager = PerformanceManager::new(profile, loaded.mode);
    manager.set_hardware_refreshed(loaded.hardware_changed);
    log::info!("performance mode: {:?}, detected tier: {:?}", manager.mode(), manager.detected_tier());
    PerformanceState(Mutex::new(manager), CpuUsageSampler::start())
}

/// Convenience for spawn-time call sites (Milestones 4b/5) that just need
/// the current effective config without holding onto the manager. Does NOT
/// consult the Milestone 6 memory-pressure tracker — see
/// `effective_config_checked` for the checkpoint-driven variant that does.
pub fn effective_config(app: &AppHandle) -> manager::PerformanceConfig {
    let state = app.state::<PerformanceState>();
    let manager = state.0.lock().unwrap();
    manager.effective_config()
}

/// Milestone 6 checkpoint (extended to also cover CPU pressure, not just
/// RAM): feeds a freshly-measured available-RAM reading, plus the CPU
/// sampler's latest published reading, into the sustained-pressure tracker
/// and returns the (possibly clamped) config to use, plus a log-worthy
/// reason if the pressure state changed on this call. Callers should
/// measure RAM immediately before calling this (see
/// `profile::available_ram_mb`) — the natural checkpoints are STT sidecar
/// spawn and RAG document-upload/indexing start, not a timer. The CPU
/// reading is never measured inline here (that would block this checkpoint
/// for ~200ms — see `profile::CpuUsageSampler`'s doc); it's whatever the
/// background sampler thread most recently published, read without
/// blocking.
pub fn effective_config_checked(app: &AppHandle) -> manager::PerformanceConfig {
    let available = profile::available_ram_mb();
    let state = app.state::<PerformanceState>();
    let cpu_percent = state.1.latest_percent();
    let mut manager = state.0.lock().unwrap();
    let (config, reason) = manager.effective_config_checked(available, cpu_percent);
    if let Some(reason) = reason {
        log::warn!("performance: {reason}");
    }
    config
}

/// Milestone 7: reads the current performance-correlation context (tier,
/// mode, pressure state, effective config) without observing a new RAM
/// sample — safe to call from any pipeline-stage instrumentation point.
pub fn perf_context(app: &AppHandle) -> telemetry::PerfContext {
    let state = app.state::<PerformanceState>();
    let manager = state.0.lock().unwrap();
    manager.perf_context()
}

// Re-exported for the Milestone 6 runtime-adaptation checkpoint, which
// needs a fresh available-RAM reading independent of the cached profile.
pub use profile::available_ram_mb;
pub use manager::PerformanceConfig;
