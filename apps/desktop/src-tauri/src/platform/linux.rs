//! Linux is not a v1 target. This stub exists so the prototype builds and runs in a Linux VM:
//! no global mouse listener, so only Alt+` triggers, and the X11 primary selection stands in for
//! accessibility-based capture.

use std::sync::mpsc::Sender;
use std::time::Instant;

use arboard::{Clipboard, GetExtLinux, LinuxClipboardKind};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use super::{Capture, CaptureError, MouseEvent};
use crate::controller::OVERLAY;
use crate::env::{AppInfo, Environment};
use crate::geometry::{Display, Point, Rect};

pub const POINTER_EVENTS: bool = false;

pub fn ensure_permissions() -> bool {
    true
}

pub fn accessibility_allowed() -> bool {
    true
}

pub fn open_accessibility_settings() {}

pub fn start_mouse_listener(_tx: Sender<MouseEvent>) {}

pub struct Capturer {
    clipboard: Option<Clipboard>,
}

impl Capturer {
    pub fn new() -> Self {
        Self {
            clipboard: Clipboard::new().ok(),
        }
    }

    pub fn selection(&mut self, _deadline: Instant, _skip: impl Fn(&AppInfo) -> bool) -> Result<Capture, CaptureError> {
        let clipboard = self.clipboard.as_mut().ok_or(CaptureError::Unsupported)?;
        let text = clipboard
            .get()
            .clipboard(LinuxClipboardKind::Primary)
            .text()
            .unwrap_or_default();
        if text.trim().is_empty() {
            return Err(CaptureError::NoText {
                app: AppInfo::default(),
            });
        }
        Ok(Capture {
            text,
            context_before: None,
            context_after: None,
            bounds: None,
            app: AppInfo::default(),
            method: "x11-primary",
        })
    }

    /// Clipboard fallback; not implemented on this platform yet.
    pub fn copy_selection(&mut self) -> Option<String> {
        None
    }

    pub fn environment(&mut self, _app: &AppInfo) -> Environment {
        Environment::default()
    }
}

pub fn display_at(app: &AppHandle, p: Point) -> Option<Display> {
    let monitor = app
        .monitor_from_point(p.x, p.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    Some(Display {
        origin: Point {
            x: area.position.x as f64,
            y: area.position.y as f64,
        },
        width: area.size.width as f64,
        height: area.size.height as f64,
        scale: monitor.scale_factor(),
    })
}

pub fn cursor_position(app: &AppHandle) -> Option<Point> {
    let p = app.cursor_position().ok()?;
    Some(Point { x: p.x, y: p.y })
}

pub fn with_no_activate<T>(f: impl FnOnce() -> T) -> T {
    f()
}

pub fn setup_overlay(app: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    setup_overlay_with_frame(app, window, None)
}

pub fn setup_overlay_with_frame(_app: &AppHandle, _window: &WebviewWindow, _frame: Option<Rect>) -> tauri::Result<()> {
    Ok(())
}

pub fn set_ignore_cursor(app: &AppHandle, ignore: bool) {
    set_ignore_cursor_of(app, OVERLAY, ignore);
}

pub fn set_ignore_cursor_of(app: &AppHandle, label: &str, ignore: bool) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.set_ignore_cursor_events(ignore);
    }
}

pub fn set_frame(app: &AppHandle, frame: Rect) {
    set_frame_of(app, OVERLAY, frame);
}

pub fn set_frame_of(app: &AppHandle, label: &str, frame: Rect) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.set_size(PhysicalSize::new(
            frame.width.round() as u32,
            frame.height.round() as u32,
        ));
        let _ = w.set_position(PhysicalPosition::new(frame.x.round() as i32, frame.y.round() as i32));
    }
}

pub fn show(app: &AppHandle) {
    show_of(app, OVERLAY);
}

pub fn show_of(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.show();
    }
}

pub fn hide(app: &AppHandle) {
    hide_of(app, OVERLAY);
}

pub fn hide_of(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.hide();
    }
}

pub fn teardown_panel(_app: &AppHandle, _label: &str) {}

pub fn set_keyboard_focus(app: &AppHandle, on: bool) {
    set_keyboard_focus_of(app, OVERLAY, on);
}

pub fn prepare_keyboard_focus(app: &AppHandle) {
    prepare_keyboard_focus_of(app, OVERLAY);
}

pub fn prepare_keyboard_focus_of(app: &AppHandle, label: &str) {
    set_keyboard_focus_of(app, label, true);
}

pub fn set_keyboard_focus_of(app: &AppHandle, label: &str, on: bool) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.set_focusable(on);
        if on {
            let _ = w.set_focus();
        }
    }
}
