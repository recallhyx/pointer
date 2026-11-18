//! Commands are async so they run off the main thread and can wait for main-thread window work.

use std::sync::Arc;

use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_autostart::ManagerExt;

use crate::controller::Controller;
use crate::env::AppInfo;
use crate::geometry::Rect;

type Ctrl<'a> = State<'a, Arc<Controller>>;

#[tauri::command]
pub async fn overlay_present(ctrl: Ctrl<'_>, session: u64, frame: Rect, hit: Rect) -> Result<(), String> {
    ctrl.present(session, frame, hit)
}

#[tauri::command]
pub async fn overlay_set_hit(ctrl: Ctrl<'_>, session: u64, hit: Rect) -> Result<(), String> {
    ctrl.set_hit(session, hit)
}

#[tauri::command]
pub async fn overlay_set_frame(ctrl: Ctrl<'_>, session: u64, frame: Rect) -> Result<(), String> {
    ctrl.set_frame(session, frame)
}

#[tauri::command]
pub async fn overlay_painted(ctrl: Ctrl<'_>, session: u64) -> Result<Option<f64>, String> {
    Ok(ctrl.painted(session))
}

#[tauri::command]
pub async fn overlay_engage(ctrl: Ctrl<'_>, session: u64) -> Result<(), String> {
    ctrl.engage(session)
}

#[tauri::command]
pub async fn overlay_hide(ctrl: Ctrl<'_>, session: u64) -> Result<(), String> {
    ctrl.hide(session);
    Ok(())
}

#[tauri::command]
pub async fn set_trigger_shortcut(ctrl: Ctrl<'_>, accelerator: Option<String>) -> Result<(), String> {
    ctrl.set_shortcut(accelerator.as_deref())
}

#[tauri::command]
pub async fn pause_trigger_shortcut(ctrl: Ctrl<'_>, paused: bool) -> Result<(), String> {
    ctrl.pause_shortcut(paused);
    Ok(())
}

#[tauri::command]
pub async fn recent_apps(ctrl: Ctrl<'_>) -> Result<Vec<AppInfo>, String> {
    Ok(ctrl.recent_apps())
}

#[tauri::command]
pub async fn autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    if enabled { launcher.enable() } else { launcher.disable() }.map_err(|e| e.to_string())
}

// 固定浮层. Commands from a pinned page act on the window that sent them.

#[tauri::command]
pub async fn pin_open(
    ctrl: Ctrl<'_>,
    session: u64,
    surface: Rect,
    max_height: f64,
    direction: crate::pins::Direction,
    init: serde_json::Value,
) -> Result<String, String> {
    ctrl.pin_open(session, surface, max_height, direction, init)
}

#[tauri::command]
pub async fn pin_init(ctrl: Ctrl<'_>, window: WebviewWindow) -> Result<Option<serde_json::Value>, String> {
    Ok(ctrl.pin_init(window.label()))
}

#[tauri::command]
pub async fn pin_show(ctrl: Ctrl<'_>, window: WebviewWindow) -> Result<(), String> {
    ctrl.pin_show(window.label())
}

#[tauri::command]
pub async fn pin_painted(ctrl: Ctrl<'_>, window: WebviewWindow) -> Result<(), String> {
    ctrl.pin_painted(window.label())
}

#[tauri::command]
pub async fn pin_resize(ctrl: Ctrl<'_>, window: WebviewWindow, height: f64) -> Result<(), String> {
    ctrl.pin_resize(window.label(), height)
}

#[tauri::command]
pub async fn pin_drag(ctrl: Ctrl<'_>, window: WebviewWindow) -> Result<(), String> {
    ctrl.pin_drag(window.label())
}

#[tauri::command]
pub async fn pin_engage(ctrl: Ctrl<'_>, window: WebviewWindow) -> Result<(), String> {
    ctrl.pin_engage(window.label())
}

#[tauri::command]
pub async fn pin_close(ctrl: Ctrl<'_>, window: WebviewWindow) -> Result<(), String> {
    ctrl.pin_close(window.label())
}

#[tauri::command]
pub async fn pin_cancel(ctrl: Ctrl<'_>, label: String) -> Result<(), String> {
    ctrl.pin_cancel(&label)
}

#[tauri::command]
pub async fn pin_set_fixed(ctrl: Ctrl<'_>, window: WebviewWindow, fixed: bool) -> Result<(), String> {
    ctrl.pin_set_fixed(window.label(), fixed)
}

// —— On-device OCR (macOS Vision) ——

#[tauri::command]
pub async fn set_ocr_shortcut(ctrl: Ctrl<'_>, accelerator: Option<String>) -> Result<(), String> {
    ctrl.set_ocr_shortcut(accelerator.as_deref())
}

#[tauri::command]
pub async fn ocr_start(ctrl: Ctrl<'_>) -> Result<(), String> {
    ctrl.start_ocr()
}

#[tauri::command]
pub async fn ocr_complete(ctrl: Ctrl<'_>, region: Rect) -> Result<crate::ocr::OcrPreview, String> {
    let ctrl = ctrl.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ctrl.complete_ocr(region))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ocr_present(ctrl: Ctrl<'_>) -> Result<(), String> {
    let ctrl = ctrl.inner().clone();
    tauri::async_runtime::spawn_blocking(move || ctrl.present_ocr())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ocr_cancel(ctrl: Ctrl<'_>) -> Result<(), String> {
    ctrl.cancel_ocr();
    Ok(())
}

#[tauri::command]
pub async fn ocr_screen_permission() -> Result<bool, String> {
    Ok(crate::ocr::screen_capture_allowed())
}

#[tauri::command]
pub async fn ocr_request_screen_permission() -> Result<bool, String> {
    Ok(crate::ocr::request_screen_capture())
}

#[tauri::command]
pub async fn ocr_open_screen_settings() -> Result<(), String> {
    crate::ocr::open_screen_capture_settings();
    Ok(())
}

#[tauri::command]
pub async fn accessibility_permission() -> Result<bool, String> {
    Ok(crate::platform::accessibility_allowed())
}

/// Triggers the system prompt (first run only; afterwards it silently reflects the toggle).
#[tauri::command]
pub async fn accessibility_request() -> Result<bool, String> {
    Ok(crate::platform::ensure_permissions())
}

#[tauri::command]
pub async fn accessibility_open_settings() -> Result<(), String> {
    crate::platform::open_accessibility_settings();
    Ok(())
}

#[tauri::command]
pub async fn ocr_lightbox_open(ctrl: Ctrl<'_>, image: String) -> Result<(), String> {
    ctrl.open_ocr_lightbox(image)
}

#[tauri::command]
pub async fn ocr_lightbox_peek(ctrl: Ctrl<'_>) -> Result<Option<String>, String> {
    Ok(ctrl.lightbox_image())
}

#[tauri::command]
pub async fn ocr_lightbox_close(ctrl: Ctrl<'_>) -> Result<(), String> {
    ctrl.close_ocr_lightbox();
    Ok(())
}
