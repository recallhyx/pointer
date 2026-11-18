//! The part of the settings file the Rust side acts on. The settings window owns the file
//! (`src/shared/settings.ts`); this side reads it at startup and again on every store change.

use std::path::PathBuf;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Listener};
use tauri_plugin_store::StoreExt;

const FILE: &str = "settings.json";
const KEY: &str = "settings";
const DEFAULT_EXCLUDED: &str = include_str!("../../src/shared/default-excluded-apps.json");
pub const DEFAULT_SHORTCUT: &str = "Alt+Backquote";
/// Wireframe default: ⌥⌘O.
pub const DEFAULT_OCR_SHORTCUT: &str = "Alt+Super+KeyO";

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct ExcludedApp {
    pub id: String,
}

/// Missing fields take their defaults, matching `sanitize` in `settings.ts`.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub auto_trigger: bool,
    /// Clipboard fallback when accessibility finds no text.
    pub clipboard_fallback: bool,
    /// Accelerator such as `Alt+Backquote`; `null` in the file turns the shortcut off.
    pub shortcut: Option<String>,
    /// Screen-region OCR shortcut; `null` turns it off.
    pub ocr_shortcut: Option<String>,
    /// When selection text is unavailable, OCR near the selection (default off; wired later).
    pub ocr_auto_fallback: bool,
    /// `system`, `zh-Hans`, or `en-US`.
    pub ocr_language: String,
    pub excluded_apps: Vec<ExcludedApp>,
    /// `zh`, `en` or `system`.
    pub ui_language: String,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            auto_trigger: true,
            clipboard_fallback: true,
            shortcut: Some(DEFAULT_SHORTCUT.into()),
            ocr_shortcut: Some(DEFAULT_OCR_SHORTCUT.into()),
            ocr_auto_fallback: false,
            ocr_language: "system".into(),
            excluded_apps: serde_json::from_str(DEFAULT_EXCLUDED).expect("default-excluded-apps.json"),
            ui_language: "system".into(),
        }
    }
}

fn parse(value: Option<Value>) -> Prefs {
    match value {
        None | Some(Value::Null) => Prefs::default(),
        Some(v) => serde_json::from_value(v).unwrap_or_else(|e| {
            eprintln!("[pointer] settings unreadable, using defaults: {e}");
            Prefs::default()
        }),
    }
}

pub fn load(app: &AppHandle) -> Prefs {
    parse(app.store(FILE).ok().and_then(|s| s.get(KEY)))
}

/// Calls `f` with the new prefs whenever the settings window saves. `f` runs on its own thread,
/// so it may wait for the main thread.
pub fn watch(app: &AppHandle, f: impl Fn(Prefs) + Clone + Send + Sync + 'static) {
    #[derive(Deserialize)]
    struct Change {
        path: PathBuf,
        key: String,
        value: Option<Value>,
    }
    app.listen_any("store://change", move |event| {
        let Ok(change) = serde_json::from_str::<Change>(event.payload()) else {
            return;
        };
        if change.key != KEY || change.path.file_name().is_none_or(|n| n != FILE) {
            return;
        }
        let prefs = parse(change.value);
        let f = f.clone();
        std::thread::spawn(move || f(prefs));
    });
}
