//! Single source of truth for performance-mode preference and the hardware
//! tier it resolves to. Detects hardware once at app launch, combines it
//! with the user's persisted mode preference, and exposes one
//! `effective_config()`.
//!
//! Historically this table also drove STT thread counts and RAG
//! embedding/retrieval tuning (see `docs/performance-tuning.md`'s
//! Milestone 4a benchmark sweep for that history) — STT is now a Deepgram
//! cloud connection with no local thread pool to size, and RAG search has
//! been removed entirely (the bundled `rag-lite` service only ever did
//! text extraction in this build, never real search), so `PerformanceConfig`
//! no longer carries either. What remains is the hardware-tier
//! detection/mode-preference machinery itself, which the Performance panel
//! still surfaces to the user.

use super::pressure::PressureTracker;
use super::profile::HardwareProfile;
use super::tier::{self, HardwareTier};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PerformanceMode {
    Adaptive,
    MaximumPerformance,
    BatterySaver,
}

impl Default for PerformanceMode {
    fn default() -> Self {
        Self::Adaptive
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceConfig {
    /// Currently unused by any spawn path (STT is a Deepgram cloud
    /// connection, not a local thread pool) — kept as inert reported data
    /// rather than torn out, since removing it would mean rewriting the
    /// whole tier table/pressure-clamping/test suite below for a field
    /// that costs nothing left in place.
    pub stt_num_threads: u32,
}

/// Tier → config lookup. Values preserved from the pre-Deepgram benchmark
/// table (see git history for the full rationale) purely as informational,
/// still-conservative-scaling-with-tier reported data — `pressure.rs`
/// clamps down to the Entry row under sustained pressure, so Entry must
/// stay the floor. Nothing actually sizes a thread pool from this anymore.
pub(super) fn config_for_tier(tier: HardwareTier, _logical_cores: usize) -> PerformanceConfig {
    match tier {
        HardwareTier::Entry => PerformanceConfig { stt_num_threads: 1 },
        HardwareTier::Standard | HardwareTier::Performance | HardwareTier::HighPerformance => {
            PerformanceConfig { stt_num_threads: 4 }
        }
    }
}

pub struct PerformanceManager {
    profile: HardwareProfile,
    tier: HardwareTier,
    mode: PerformanceMode,
    /// Milestone 6: sustained-memory-pressure overlay. Consulted only by
    /// `effective_config_checked` — plain `effective_config()` stays a
    /// pure function of tier/mode, unaffected by runtime memory state, so
    /// existing callers that haven't been updated to pass a fresh RAM
    /// reading keep their prior behavior exactly.
    pressure: PressureTracker,
    /// Set by `hardware::init` (via `set_hardware_refreshed`) when the
    /// persisted hardware fingerprint didn't match this machine's — i.e.
    /// this launch invalidated a stale, explicit mode override that was
    /// chosen on a different physical PC. Purely informational (surfaced by
    /// `get_performance_mode` for the Performance panel, see
    /// `hardware::commands`); never itself affects `effective_config()`.
    hardware_refreshed: bool,
}

impl PerformanceManager {
    pub fn new(profile: HardwareProfile, mode: PerformanceMode) -> Self {
        let tier = tier::classify(&profile);
        Self { profile, tier, mode, pressure: PressureTracker::default(), hardware_refreshed: false }
    }

    pub fn profile(&self) -> &HardwareProfile {
        &self.profile
    }

    /// This machine's hardware fingerprint (see `hardware::fingerprint`) —
    /// used to tag a persisted mode change so a later launch on different
    /// hardware knows not to trust it.
    pub fn hardware_fingerprint(&self) -> String {
        super::fingerprint::compute(&self.profile)
    }

    pub fn detected_tier(&self) -> HardwareTier {
        self.tier
    }

    pub fn mode(&self) -> PerformanceMode {
        self.mode
    }

    pub fn set_hardware_refreshed(&mut self, refreshed: bool) {
        self.hardware_refreshed = refreshed;
    }

    /// See `hardware_refreshed` field doc.
    pub fn hardware_refreshed(&self) -> bool {
        self.hardware_refreshed
    }

    /// Milestone 7: current memory-pressure state, for correlating logged
    /// pipeline-stage timings with whether a downgrade was in effect. Pure
    /// read — does not itself observe a new RAM sample (that only happens
    /// via `effective_config_checked`).
    pub fn pressure_state(&self) -> super::pressure::PressureState {
        self.pressure.state()
    }

    /// Milestone 7: builds the performance-correlation context
    /// (`telemetry::PerfContext`) callers attach to a logged stage timing —
    /// current tier/mode/pressure state plus the config actually in effect
    /// (uses `effective_config()`, not `effective_config_checked`, since
    /// this is a read for logging purposes and must not itself trigger a
    /// pressure-state observation as a side effect of measuring latency).
    pub fn perf_context(&self) -> super::telemetry::PerfContext {
        super::telemetry::PerfContext::new(self.tier, self.mode, self.pressure.state(), &self.effective_config())
    }

    pub fn set_mode(&mut self, mode: PerformanceMode) {
        self.mode = mode;
    }

    /// The config actually in effect right now: `Adaptive` uses the
    /// detected tier's row; `MaximumPerformance`/`BatterySaver` are
    /// absolute overrides (force the HighPerformance/Entry row) regardless
    /// of detected tier — a deliberate user opt-in, not a blend with the
    /// detected tier.
    pub fn effective_config(&self) -> PerformanceConfig {
        let tier = match self.mode {
            PerformanceMode::Adaptive => self.tier,
            PerformanceMode::MaximumPerformance => HardwareTier::HighPerformance,
            PerformanceMode::BatterySaver => HardwareTier::Entry,
        };
        config_for_tier(tier, self.profile.cpu_logical_cores)
    }

    /// Same as `effective_config()`, but first feeds a freshly-measured
    /// available-RAM reading, plus the latest published CPU-utilization
    /// reading (see `profile::CpuUsageSampler`; `None` if no sample has
    /// published yet), into the sustained-pressure tracker and, if
    /// currently under pressure, clamps the reported config down
    /// accordingly. Call sites that just want to *display* the configured
    /// tier (e.g. the Performance panel) should keep using
    /// `effective_config()` so the UI reflects the user's selected mode,
    /// not a transient runtime dip.
    ///
    /// Returns the config to use, plus `Some(reason)` if the pressure state
    /// changed on this call — callers should log that reason, since an
    /// automatic downgrade or restoration should always be visible in the
    /// logs, not silent.
    pub fn effective_config_checked(
        &mut self,
        available_ram_mb: u64,
        cpu_usage_percent: Option<f32>,
    ) -> (PerformanceConfig, Option<String>) {
        let reason = self.pressure.observe(available_ram_mb, cpu_usage_percent, std::time::Instant::now());
        let config = self.pressure.apply(self.effective_config());
        (config, reason)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile_with(cores: usize, ram_gb: u64) -> HardwareProfile {
        HardwareProfile {
            cpu_physical_cores: cores / 2,
            cpu_logical_cores: cores,
            cpu_brand: "Test CPU".to_string(),
            total_ram_mb: ram_gb * 1024,
            available_ram_mb: ram_gb * 1024 / 2,
            gpu_vendor: None,
            gpu_name: None,
            gpu_vram_mb: None,
            storage_is_ssd: None,
            windows_version: "Windows 11".to_string(),
        }
    }

    #[test]
    fn entry_tier_reports_the_lowest_stt_thread_count() {
        assert_eq!(config_for_tier(HardwareTier::Entry, 8).stt_num_threads, 1);
    }

    #[test]
    fn every_tier_above_entry_reports_the_same_fixed_stt_thread_count() {
        for tier in [HardwareTier::Standard, HardwareTier::Performance, HardwareTier::HighPerformance] {
            assert_eq!(config_for_tier(tier, 8).stt_num_threads, 4);
        }
    }

    // -- mode propagation: Adaptive / MaximumPerformance / BatterySaver -----

    #[test]
    fn adaptive_mode_uses_the_detected_tiers_config() {
        let high_end = profile_with(16, 16); // scores into HighPerformance
        let manager = PerformanceManager::new(high_end, PerformanceMode::Adaptive);
        assert_eq!(manager.detected_tier(), HardwareTier::HighPerformance);
        let cfg = manager.effective_config();
        assert_eq!(cfg.stt_num_threads, config_for_tier(HardwareTier::HighPerformance, 16).stt_num_threads);
    }

    #[test]
    fn adaptive_mode_on_low_end_hardware_uses_entry_config_not_a_forced_upgrade() {
        let low_end = profile_with(2, 4); // scores into Entry
        let manager = PerformanceManager::new(low_end, PerformanceMode::Adaptive);
        assert_eq!(manager.detected_tier(), HardwareTier::Entry);
        let cfg = manager.effective_config();
        assert_eq!(cfg.stt_num_threads, 1);
    }

    #[test]
    fn maximum_performance_forces_high_performance_config_even_on_low_end_hardware() {
        // A deliberate user opt-in to spend more resources than the
        // detected tier would normally use — must override, not blend.
        let low_end = profile_with(2, 4);
        let manager = PerformanceManager::new(low_end, PerformanceMode::MaximumPerformance);
        assert_eq!(manager.detected_tier(), HardwareTier::Entry); // detection itself is unaffected
        let cfg = manager.effective_config();
        assert_eq!(cfg.stt_num_threads, config_for_tier(HardwareTier::HighPerformance, 2).stt_num_threads);
    }

    #[test]
    fn battery_saver_forces_entry_config_even_on_high_end_hardware() {
        // A deliberate user opt-in to conserve resources despite capable
        // hardware — must override, not blend.
        let high_end = profile_with(16, 16);
        let manager = PerformanceManager::new(high_end, PerformanceMode::BatterySaver);
        assert_eq!(manager.detected_tier(), HardwareTier::HighPerformance); // detection itself is unaffected
        let cfg = manager.effective_config();
        assert_eq!(cfg.stt_num_threads, 1);
    }

    #[test]
    fn performance_mode_defaults_to_adaptive() {
        assert_eq!(PerformanceMode::default(), PerformanceMode::Adaptive);
    }

    // -- hardware_refreshed: purely informational, set by hardware::init ----

    #[test]
    fn hardware_refreshed_defaults_to_false() {
        let manager = PerformanceManager::new(profile_with(8, 8), PerformanceMode::Adaptive);
        assert!(!manager.hardware_refreshed());
    }

    #[test]
    fn set_hardware_refreshed_is_observable_and_does_not_affect_effective_config() {
        let mut manager = PerformanceManager::new(profile_with(8, 8), PerformanceMode::Adaptive);
        let before = manager.effective_config().stt_num_threads;
        manager.set_hardware_refreshed(true);
        assert!(manager.hardware_refreshed());
        assert_eq!(manager.effective_config().stt_num_threads, before);
    }

    #[test]
    fn hardware_fingerprint_reflects_this_managers_profile() {
        let manager = PerformanceManager::new(profile_with(8, 8), PerformanceMode::Adaptive);
        assert_eq!(manager.hardware_fingerprint(), super::super::fingerprint::compute(manager.profile()));
    }

    // -- effective_config_checked: PerformanceManager <-> PressureTracker ---
    // (PressureTracker's own state-machine behavior — entering/exiting
    // pressure, hysteresis, cooldown — is covered exhaustively in
    // hardware::pressure::tests; these confirm the manager actually wires a
    // fresh RAM reading through to it and applies the result.)

    #[test]
    fn effective_config_checked_matches_plain_effective_config_when_ram_is_healthy() {
        let mut manager = PerformanceManager::new(profile_with(16, 16), PerformanceMode::Adaptive);
        let (checked, reason) = manager.effective_config_checked(8_000, None);
        assert!(reason.is_none());
        assert_eq!(checked.stt_num_threads, manager.effective_config().stt_num_threads);
    }

    #[test]
    fn effective_config_checked_clamps_down_after_sustained_low_readings() {
        let mut manager = PerformanceManager::new(profile_with(16, 16), PerformanceMode::Adaptive);
        let baseline = manager.effective_config();
        assert_eq!(baseline.stt_num_threads, 4);

        let (_, reason1) = manager.effective_config_checked(500, None);
        assert!(reason1.is_none()); // first low reading — not sustained yet

        let (checked, reason2) = manager.effective_config_checked(500, None);
        assert!(reason2.is_some(), "second consecutive low reading should trigger pressure");
        assert_eq!(checked.stt_num_threads, 1); // clamped to Entry's value
    }

    #[test]
    fn effective_config_checked_clamps_down_after_sustained_high_cpu_even_with_healthy_ram() {
        let mut manager = PerformanceManager::new(profile_with(16, 16), PerformanceMode::Adaptive);
        let baseline = manager.effective_config();
        assert_eq!(baseline.stt_num_threads, 4);

        let (_, reason1) = manager.effective_config_checked(8_000, Some(96.0));
        assert!(reason1.is_none()); // first high-CPU reading — not sustained yet

        let (checked, reason2) = manager.effective_config_checked(8_000, Some(96.0));
        assert!(reason2.is_some(), "second consecutive high-CPU reading should trigger pressure");
        assert_eq!(checked.stt_num_threads, 1); // clamped to Entry's value, same ceiling as RAM pressure
    }

    #[test]
    fn effective_config_checked_with_no_cpu_reading_behaves_exactly_like_ram_only_pressure() {
        // Mirrors the pre-CPU-pressure behavior exactly when the sampler
        // hasn't published a reading yet — a regression guard that adding
        // CPU pressure didn't change existing RAM-only call sites'
        // behavior when they simply don't have a CPU reading available.
        let mut manager = PerformanceManager::new(profile_with(16, 16), PerformanceMode::Adaptive);
        manager.effective_config_checked(500, None);
        let (checked, reason) = manager.effective_config_checked(500, None);
        assert!(reason.is_some());
        assert_eq!(checked.stt_num_threads, 1);
    }
}
