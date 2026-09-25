//! Screen capture for the "Analyze Screen" flow — grabs a PNG of the primary
//! monitor via `xcap` so it can be sent to a vision-capable LLM alongside the
//! usual interview context (see `personal::prompts::screen`).
//!
//! The Interview Mode overlay window is excluded from screen capture at the
//! OS level (see `windows_capture_protection::reconcile`, applied when the
//! overlay is shown) via `SetWindowDisplayAffinity`, which
//! affects capture through the same OS compositor APIs `xcap` uses on
//! Windows — so this full-screen grab never includes the overlay itself,
//! without this module needing to know anything about window positions.

use base64::Engine;
use xcap::image::codecs::jpeg::JpegEncoder;
use xcap::image::{imageops, DynamicImage, RgbaImage};
use xcap::Monitor;

/// Longest side a captured screenshot is scaled down to before it's sent to
/// the model — plenty to read code and slide text, while keeping the PNG
/// encode (and the upload) fast enough for tap-tap-tap capture.
const SHOT_MAX_SIDE: u32 = 1600;
/// Width of the overlay's thumbnail strip images.
const THUMB_WIDTH: u32 = 240;

fn capture_primary_rgba() -> Result<RgbaImage, String> {
    let monitors = Monitor::all().map_err(|e| format!("failed to list monitors: {e}"))?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| "no screen found to capture".to_string())?;
    monitor.capture_image().map_err(|e| format!("screen capture failed: {e}"))
}

/// JPEG quality for the image sent to the model: text and code stay crisp,
/// while the upload is roughly a tenth of an equivalent PNG — the upload was
/// most of the wait before the first word when several screenshots were sent.
const SHOT_JPEG_QUALITY: u8 = 82;

/// One screenshot from the overlay's Screenshot button: the model-sized JPEG
/// (base64) kept on the Rust side until the next Answer, plus a small JPEG
/// thumbnail (data URL) for the overlay to show straight away.
pub struct CapturedShot {
    pub image_base64: String,
    pub thumbnail_data_url: String,
}

pub fn capture_shot() -> Result<CapturedShot, String> {
    let image = capture_primary_rgba()?;
    let (w, h) = image.dimensions();
    let scale = (SHOT_MAX_SIDE as f32 / w.max(h) as f32).min(1.0);
    let image = if scale < 1.0 {
        let (nw, nh) = (((w as f32) * scale).round() as u32, ((h as f32) * scale).round() as u32);
        imageops::resize(&image, nw.max(1), nh.max(1), imageops::FilterType::Triangle)
    } else {
        image
    };

    let thumb_height = ((image.height() as f32) * THUMB_WIDTH as f32 / image.width() as f32).round().max(1.0) as u32;
    let thumb = DynamicImage::ImageRgba8(imageops::thumbnail(&image, THUMB_WIDTH, thumb_height)).to_rgb8();
    let rgb = DynamicImage::ImageRgba8(image).to_rgb8();

    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, SHOT_JPEG_QUALITY)
        .encode_image(&rgb)
        .map_err(|e| format!("failed to encode screenshot: {e}"))?;
    let mut thumb_jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut thumb_jpeg, 70)
        .encode_image(&thumb)
        .map_err(|e| format!("failed to encode thumbnail: {e}"))?;

    let b64 = base64::engine::general_purpose::STANDARD;
    Ok(CapturedShot {
        image_base64: b64.encode(jpeg),
        thumbnail_data_url: format!("data:image/jpeg;base64,{}", b64.encode(thumb_jpeg)),
    })
}

pub fn capture_primary_screen_png() -> Result<Vec<u8>, String> {
    let image = capture_primary_rgba()?;

    let mut png_bytes = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png_bytes), xcap::image::ImageFormat::Png)
        .map_err(|e| format!("failed to encode screenshot as PNG: {e}"))?;

    Ok(png_bytes)
}
