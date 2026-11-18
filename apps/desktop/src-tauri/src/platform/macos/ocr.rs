//! On-device screen OCR via Apple Vision (`VNRecognizeTextRequest`).
//! Screen pixels are captured with `screencapture` (triggers Screen Recording permission),
//! then recognized locally — the image is not uploaded.
//! The OCR picker uses `NSWindowSharingNone` so this capture never includes the selection mask.

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use objc2::runtime::AnyObject;
use objc2::AnyThread;
use objc2_foundation::{NSArray, NSDictionary, NSString, NSURL};
use objc2_vision::{VNImageRequestHandler, VNRecognizeTextRequest, VNRequestTextRecognitionLevel};

use crate::geometry::Rect;
use crate::ocr::OcrBox;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

pub fn screen_capture_allowed() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

pub fn request_screen_capture() -> bool {
    unsafe { CGRequestScreenCaptureAccess() }
}

/// Opens System Settings → Privacy → Screen Recording (best-effort).
pub fn open_screen_capture_settings() {
    // See the matching comment in `platform/macos/mod.rs::open_accessibility_settings` —
    // the legacy `com.apple.preference.security` URL no longer opens Privacy & Security on
    // macOS 14+ (confirmed broken on macOS 26 Tahoe). Try the current scheme first.
    let opened = Command::new("open")
        .arg("x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture")
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !opened {
        let _ = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .status();
    }
}

pub struct OcrOutcome {
    pub text: String,
    pub confidence: f32,
    /// `data:image/png;base64,...` of the cropped capture (for the overlay thumbnail).
    pub image_data_url: String,
    /// Text regions in normalized selection coords (top-left origin, 0–1).
    pub boxes: Vec<OcrBox>,
}

/// Capture `native` (global top-left origin, points) then run Vision OCR.
pub fn recognize_region(native: Rect, languages: &[String]) -> Result<OcrOutcome, String> {
    if native.width < 2.0 || native.height < 2.0 {
        return Err("selection too small".into());
    }
    if !screen_capture_allowed() {
        let _ = request_screen_capture();
        if !screen_capture_allowed() {
            return Err("screen-recording-denied".into());
        }
    }

    let path = temp_png_path()?;
    let region = format!(
        "{},{},{},{}",
        native.x.round() as i64,
        native.y.round() as i64,
        native.width.round().max(1.0) as i64,
        native.height.round().max(1.0) as i64
    );
    // `-x` silences the shutter; `-t png` keeps a Vision-friendly format.
    let status = Command::new("screencapture")
        .args([
            "-x",
            "-t",
            "png",
            &format!("-R{region}"),
            path.to_str().unwrap_or_default(),
        ])
        .status()
        .map_err(|e| format!("screencapture failed to start: {e}"))?;
    if !status.success() {
        let _ = fs::remove_file(&path);
        return Err("screencapture failed (check Screen Recording permission)".into());
    }
    let bytes = fs::read(&path).map_err(|e| format!("read capture failed: {e}"))?;
    let outcome = recognize_image_file(&path, languages);
    let _ = fs::remove_file(&path);
    let mut out = outcome?;
    use base64::Engine;
    out.image_data_url = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    );
    Ok(out)
}

fn temp_png_path() -> Result<PathBuf, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir();
    Ok(dir.join(format!("pointer-ocr-{nanos}.png")))
}

fn recognize_image_file(path: &std::path::Path, languages: &[String]) -> Result<OcrOutcome, String> {
    let path_str = path.to_str().ok_or("ocr path is not utf-8")?;
    let ns_path = NSString::from_str(path_str);
    let url = NSURL::fileURLWithPath(&ns_path);

    let request = VNRecognizeTextRequest::new();
    request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
    request.setUsesLanguageCorrection(true);
    if languages.is_empty() {
        request.setAutomaticallyDetectsLanguage(true);
    } else {
        let retained: Vec<_> = languages.iter().map(|l| NSString::from_str(l)).collect();
        let arr = NSArray::from_retained_slice(&retained);
        request.setRecognitionLanguages(&arr);
    }

    let options: objc2::rc::Retained<NSDictionary<NSString, AnyObject>> = NSDictionary::new();
    let handler = unsafe { VNImageRequestHandler::initWithURL_options(VNImageRequestHandler::alloc(), &url, &options) };

    let request_ref: &objc2_vision::VNRequest = &request;
    let requests = NSArray::from_slice(&[request_ref]);
    handler
        .performRequests_error(&requests)
        .map_err(|e| format!("Vision perform failed: {e}"))?;

    let mut lines: Vec<String> = Vec::new();
    let mut boxes: Vec<OcrBox> = Vec::new();
    let mut conf_sum = 0.0f32;
    let mut conf_n = 0u32;
    if let Some(results) = request.results() {
        for obs in results.iter() {
            let tops = obs.topCandidates(1);
            let mut kept = false;
            for best in tops.iter().take(1) {
                let s = best.string().to_string();
                if !s.trim().is_empty() {
                    lines.push(s);
                    conf_sum += best.confidence();
                    conf_n += 1;
                    kept = true;
                }
            }
            if !kept {
                continue;
            }
            // Vision normalized box: origin at lower-left. Convert to CSS top-left 0–1.
            // boundingBox lives on VNDetectedObjectObservation (gated by VNObservation +
            // objc2-core-foundation); Retained<VNRecognizedTextObservation> Deref's through.
            let bb = unsafe { obs.boundingBox() };
            let w = bb.size.width;
            let h = bb.size.height;
            if w <= 0.0 || h <= 0.0 {
                continue;
            }
            boxes.push(OcrBox {
                x: bb.origin.x.clamp(0.0, 1.0),
                y: (1.0 - bb.origin.y - h).clamp(0.0, 1.0),
                width: w.clamp(0.0, 1.0),
                height: h.clamp(0.0, 1.0),
            });
        }
    }

    // Reading order: top→bottom, then left→right within a row.
    boxes.sort_by(|a, b| {
        const ROW: f64 = 0.02;
        let ay = (a.y / ROW).floor() as i64;
        let by = (b.y / ROW).floor() as i64;
        ay.cmp(&by)
            .then(a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
    });

    let text = lines.join("\n").trim().to_string();
    if text.is_empty() {
        return Err("no-text".into());
    }
    let confidence = if conf_n == 0 { 0.0 } else { conf_sum / conf_n as f32 };
    Ok(OcrOutcome {
        text,
        confidence,
        image_data_url: String::new(),
        boxes,
    })
}
