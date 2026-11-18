//! Everything that differs per OS. Each backend exposes the same free functions and a
//! `Capturer` type:
//!
//! - `POINTER_EVENTS`: whether the global mouse listener reports moves, so click-through can be
//!   toggled by hit-testing (false on the Linux stub).
//! - `start_mouse_listener(tx)`: spawns a thread that forwards global mouse events.
//! - `Capturer::new()` is created on, and only used from, one worker thread.
//! - `display_at`, `cursor_position`: may be called from any thread.
//! - `setup_overlay`, `set_frame`, `show`, `hide`, `set_keyboard_focus`: main thread only.
//! - `with_no_activate`: run window creation without activating the app (macOS); main thread.
//! - `set_ignore_cursor`: toggles click-through; any thread (macOS hops to the main thread).
//! - `teardown_panel`: restore a panelised window to NSWindow before destroy (macOS).

use crate::env::AppInfo;
use crate::geometry::{Point, Rect};

#[derive(Clone, Copy, Debug)]
pub enum MouseEvent {
    LeftDown(Point),
    LeftUp { at: Point, clicks: u32, shift: bool },
    OtherDown(Point),
    Move(Point),
    Wheel,
}

#[derive(Clone, Debug)]
pub struct Capture {
    pub text: String,
    pub context_before: Option<String>,
    pub context_after: Option<String>,
    /// Selection bounds in native screen units, when the host app reports them.
    pub bounds: Option<Rect>,
    pub app: AppInfo,
    pub method: &'static str,
}

#[derive(Clone, Debug)]
pub enum CaptureError {
    OwnApp,
    /// No focused element could be found; `app` is the frontmost app when it is known.
    NoFocusedElement {
        app: Option<AppInfo>,
    },
    NoText {
        app: AppInfo,
    },
    /// The host app is on the excluded list; nothing was read from it.
    #[cfg_attr(target_os = "linux", allow(dead_code))]
    Excluded {
        app: AppInfo,
    },
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Unsupported,
    #[cfg(any(target_os = "macos", test))]
    WithAxDiagnostics {
        error: Box<CaptureError>,
        diagnostics: Box<ax_diagnostics::AxCaptureDiagnostics>,
    },
}

impl CaptureError {
    pub fn code(&self) -> &'static str {
        match self {
            CaptureError::OwnApp => "own-app",
            CaptureError::NoFocusedElement { .. } => "no-focused-element",
            CaptureError::NoText { .. } => "no-text",
            CaptureError::Excluded { .. } => "excluded",
            CaptureError::Unsupported => "unsupported",
            #[cfg(any(target_os = "macos", test))]
            CaptureError::WithAxDiagnostics { error, .. } => error.code(),
        }
    }

    pub fn app(&self) -> Option<&AppInfo> {
        match self {
            CaptureError::NoText { app } | CaptureError::Excluded { app } => Some(app),
            CaptureError::NoFocusedElement { app } => app.as_ref(),
            #[cfg(any(target_os = "macos", test))]
            CaptureError::WithAxDiagnostics { error, .. } => error.app(),
            _ => None,
        }
    }

    pub fn ax_diagnostics(&self) -> Option<serde_json::Value> {
        #[cfg(any(target_os = "macos", test))]
        if let CaptureError::WithAxDiagnostics { diagnostics, .. } = self {
            return serde_json::to_value(diagnostics).ok();
        }
        None
    }
}

/// Characters of surrounding context to read on each side of the selection.
pub const CONTEXT_CHARS: usize = 300;

#[cfg(any(target_os = "macos", windows, test))]
mod accessible;
#[cfg(any(target_os = "macos", test))]
mod ax_diagnostics;
#[cfg(any(target_os = "macos", windows, test))]
mod clipboard;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use self::windows::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(not(target_os = "macos"))]
pub fn prepare_pin(_app: &tauri::AppHandle, _label: &str) {}

#[cfg(not(target_os = "macos"))]
pub fn reveal_pin(app: &tauri::AppHandle, _label: &str, replace_overlay: bool) {
    if replace_overlay {
        hide(app);
    }
}

/// macOS Vision OCR helpers (stubs compile away on other OS).
#[cfg(target_os = "macos")]
pub mod macos_ocr {
    pub use super::macos::ocr::*;
}
