//! On-device OCR entry points and the fullscreen region-picker window.
//! Vision runs only on macOS; other OSes return a clear unsupported error.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
#[cfg(target_os = "macos")]
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::geometry::Rect;

pub const PICKER: &str = "ocr-picker";
/// Fullscreen crop viewer — separate from the overlay so the panel never jumps.
pub const LIGHTBOX: &str = "ocr-lightbox";

/// One Vision text region, normalized to the selection (top-left origin, 0–1).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrBox {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrOutcome {
    pub text: String,
    pub confidence: f32,
    pub image_data_url: String,
    pub boxes: Vec<OcrBox>,
}

/// Lightweight payload returned after recognize so the picker can cascade ghost boxes
/// before the result overlay opens.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrPreview {
    pub boxes: Vec<OcrBox>,
    pub confidence: f32,
}

#[cfg(target_os = "macos")]
pub fn screen_capture_allowed() -> bool {
    crate::platform::macos_ocr::screen_capture_allowed()
}

#[cfg(not(target_os = "macos"))]
pub fn screen_capture_allowed() -> bool {
    false
}

#[cfg(target_os = "macos")]
pub fn request_screen_capture() -> bool {
    crate::platform::macos_ocr::request_screen_capture()
}

#[cfg(not(target_os = "macos"))]
pub fn request_screen_capture() -> bool {
    false
}

#[cfg(target_os = "macos")]
pub fn open_screen_capture_settings() {
    crate::platform::macos_ocr::open_screen_capture_settings();
}

#[cfg(not(target_os = "macos"))]
pub fn open_screen_capture_settings() {}

/// `languages` empty ⇒ Vision auto-detect (macOS). Native rect is global top-left points.
#[cfg(target_os = "macos")]
pub fn recognize_region(native: Rect, languages: &[String]) -> Result<OcrOutcome, String> {
    let out = crate::platform::macos_ocr::recognize_region(native, languages)?;
    Ok(OcrOutcome {
        text: out.text,
        confidence: out.confidence,
        image_data_url: out.image_data_url,
        boxes: out.boxes,
    })
}

#[cfg(not(target_os = "macos"))]
pub fn recognize_region(_native: Rect, _languages: &[String]) -> Result<OcrOutcome, String> {
    Err("ocr-unsupported".into())
}

/// Shows (or creates) a transparent always-on-top picker covering the display under the cursor.
/// `frame` is in **logical** desktop coordinates (top-left origin), matching Tauri window APIs.
///
/// The window uses `NSWindowSharingNone` so `screencapture` skips it while the user
/// still sees the selection (no hide/show flash around OCR).
#[cfg(target_os = "macos")]
pub fn open_picker(app: &AppHandle, frame: Rect) -> Result<(), String> {
    let pos = tauri::LogicalPosition::new(frame.x, frame.y);
    let size = tauri::LogicalSize::new(frame.width.max(1.0), frame.height.max(1.0));
    if let Some(w) = app.get_webview_window(PICKER) {
        let _ = w.set_position(tauri::Position::Logical(pos));
        let _ = w.set_size(tauri::Size::Logical(size));
        // WebView stays mounted across hide/show — clear the previous drag rect.
        let _ = w.emit("ocr://reset", ());
        w.show().map_err(|e| e.to_string())?;
        exclude_picker_from_capture(app);
        return w.set_focus().map_err(|e| e.to_string());
    }
    let w = WebviewWindowBuilder::new(app, PICKER, WebviewUrl::App("index.html".into()))
        .title("Pointer OCR")
        .inner_size(size.width, size.height)
        .position(pos.x, pos.y)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .focused(true)
        .focusable(true)
        .accept_first_mouse(true)
        .visible(true)
        .build()
        .map_err(|e| e.to_string())?;
    exclude_picker_from_capture(app);
    let _ = w.set_focus();
    Ok(())
}

pub fn close_picker(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(PICKER) {
        let _ = w.hide();
        // Keep the window around for the next invoke; destroy on quit.
        let _ = w;
    }
}

/// Make the OCR picker invisible to screen capture while still on-screen for the user.
#[cfg(target_os = "macos")]
fn exclude_picker_from_capture(app: &AppHandle) {
    let Some(window) = app.get_webview_window(PICKER) else {
        return;
    };
    // AppKit window properties must change on the main thread.
    let (tx, rx) = std::sync::mpsc::channel();
    let win = window.clone();
    if app
        .run_on_main_thread(move || {
            let _ = tx.send(set_sharing_none(&win));
        })
        .is_err()
    {
        return;
    }
    let _ = rx.recv_timeout(std::time::Duration::from_millis(400));
}

#[cfg(target_os = "macos")]
fn set_sharing_none(window: &WebviewWindow) -> bool {
    let Ok(ptr) = window.ns_window() else {
        return false;
    };
    if ptr.is_null() {
        return false;
    }
    // NSWindowSharingNone (0): visible locally, omitted from screencapture / window capture.
    unsafe {
        use objc2_app_kit::{NSWindow, NSWindowSharingType};
        (*(ptr as *mut NSWindow)).setSharingType(NSWindowSharingType::None);
    }
    true
}

/// Emit the crop (or clear) to the lightbox webview. Window create/frame is owned by Controller
/// (macOS NSPanel + `platform::set_frame_of` so the dim fills the work area).
pub fn emit_lightbox_show(app: &AppHandle, image: Option<&str>) {
    if let Some(w) = app.get_webview_window(LIGHTBOX) {
        let payload = match image {
            Some(img) => serde_json::json!({ "image": img }),
            None => serde_json::json!({ "image": serde_json::Value::Null }),
        };
        let _ = w.emit("ocr-lightbox://show", payload);
    }
}
