use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::i18n::{tr, Text};

pub const SETTINGS: &str = "settings";

/// Shows the settings window, creating it on first use. It is an ordinary focusable window,
/// unlike the overlay. `page` is an optional settings nav id (`models`, `trigger`, …).
pub fn open(app: &AppHandle, page: Option<&str>) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    let _ = app.show();
    if let Some(w) = app.get_webview_window(SETTINGS) {
        if let Some(page) = page {
            let _ = w.eval(format!(
                "window.dispatchEvent(new CustomEvent('pointer-settings-page',{{detail:{}}}))",
                serde_json::Value::String(page.to_string())
            ));
        }
        w.unminimize()?;
        w.show()?;
        return w.set_focus();
    }
    let url = match page {
        Some(p) if !p.is_empty() => format!("index.html?page={p}"),
        _ => "index.html".into(),
    };
    let w = WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App(url.into()))
        .title(tr(Text::SettingsTitle))
        .inner_size(960.0, 680.0)
        .min_inner_size(800.0, 560.0)
        .center()
        .build()?;
    w.set_focus()
}

/// Applies a changed interface language to the window if it is open.
pub fn retitle(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SETTINGS) {
        let _ = w.set_title(tr(Text::SettingsTitle));
    }
}

#[tauri::command]
pub async fn open_settings(app: AppHandle, page: Option<String>) -> Result<(), String> {
    open(&app, page.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_logs(
    ctrl: tauri::State<'_, std::sync::Arc<crate::controller::Controller>>,
    app: AppHandle,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let Some(dir) = &ctrl.log.dir else {
        return Err("no log directory".into());
    };
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}
