//! Screen capture for the "Analyze Screen" flow — grabs a PNG of the primary
//! monitor via `xcap` so it can be sent to a vision-capable LLM alongside the
//! usual interview context (see `personal::prompts::screen`).
//!
//! The Interview Mode overlay window is excluded from screen capture at the
//! OS level (see `windows_capture_protection::enable_capture_exclusion`,
//! applied when the overlay is shown) via `SetWindowDisplayAffinity`, which
//! affects capture through the same OS compositor APIs `xcap` uses on
//! Windows — so this full-screen grab never includes the overlay itself,
//! without this module needing to know anything about window positions.

use xcap::Monitor;

pub fn capture_primary_screen_png() -> Result<Vec<u8>, String> {
    let monitors = Monitor::all().map_err(|e| format!("failed to list monitors: {e}"))?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| "no screen found to capture".to_string())?;

    let image = monitor.capture_image().map_err(|e| format!("screen capture failed: {e}"))?;

    let mut png_bytes = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png_bytes), xcap::image::ImageFormat::Png)
        .map_err(|e| format!("failed to encode screenshot as PNG: {e}"))?;

    Ok(png_bytes)
}
