use tauri::{AppHandle, State};

use super::manager::{PerformanceConfig, PerformanceMode};
use super::profile::HardwareProfile;
use super::store;
use super::tier::HardwareTier;
use super::PerformanceState;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceModeInfo {
    pub mode: PerformanceMode,
    pub detected_tier: HardwareTier,
    pub effective_config: PerformanceConfig,
    /// `true` only immediately after a launch where the persisted hardware
    /// fingerprint didn't match this machine's — i.e. this is a different
    /// physical PC than the one an explicit mode override was chosen on,
    /// so it was reset to Adaptive. See `hardware::store`'s module doc.
    pub hardware_refreshed: bool,
    /// `true` when this machine scored into the lowest capability tier
    /// (`HardwareTier::Entry`) — used by the UI to show a one-time,
    /// non-blocking "your hardware is below our recommended configuration"
    /// notice. Purely informational: never affects `effective_config()`,
    /// never blocks install/launch/usage.
    pub is_below_recommended: bool,
}

#[tauri::command]
pub fn get_hardware_profile(state: State<'_, PerformanceState>) -> Result<HardwareProfile, String> {
    let manager = state.0.lock().map_err(|e| e.to_string())?;
    Ok(manager.profile().clone())
}

#[tauri::command]
pub fn get_performance_mode(state: State<'_, PerformanceState>) -> Result<PerformanceModeInfo, String> {
    let manager = state.0.lock().map_err(|e| e.to_string())?;
    Ok(PerformanceModeInfo {
        mode: manager.mode(),
        detected_tier: manager.detected_tier(),
        effective_config: manager.effective_config(),
        hardware_refreshed: manager.hardware_refreshed(),
        is_below_recommended: manager.detected_tier() == HardwareTier::Entry,
    })
}

/// Persists the mode and updates the in-memory manager immediately so the
/// Performance panel's UI reflects the new mode right away. Nothing else
/// needs restarting on a mode change: STT is a Deepgram cloud connection
/// (not a locally-sized thread pool), the document-extraction service has
/// no tier-tuned config to reapply (RAG search/embedding — the one thing
/// that ever needed a sidecar restart on mode change — has been removed
/// entirely), and the cloud LLM/backend architecture is never
/// hardware-tiered (see `hardware::manager`'s module doc).
#[tauri::command]
pub async fn set_performance_mode(
    app: AppHandle,
    performance: State<'_, PerformanceState>,
    mode: PerformanceMode,
) -> Result<(), String> {
    let mut manager = performance.0.lock().map_err(|e| e.to_string())?;
    store::save_mode(&app, mode, &manager.hardware_fingerprint())?;
    manager.set_mode(mode);
    // The user just made an explicit choice on THIS machine — any earlier
    // "reset because hardware changed" notice is now stale and should stop
    // showing.
    manager.set_hardware_refreshed(false);
    Ok(())
}
