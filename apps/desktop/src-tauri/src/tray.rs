use std::sync::Arc;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, AppHandle, Manager, Wry};
use tauri_plugin_opener::OpenerExt;

use crate::controller::Controller;
use crate::i18n::{self, tr, Text};

const TRAY_ID: &str = "pointer";

/// Kept so the menu can be relabelled when the interface language changes.
struct Items {
    hint: MenuItem<Wry>,
    ocr: MenuItem<Wry>,
    settings: MenuItem<Wry>,
    logs: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

pub fn build(app: &App, ctrl: Arc<Controller>) -> tauri::Result<()> {
    let settings = MenuItem::with_id(app, "settings", tr(Text::MenuSettings), true, None::<&str>)?;
    let ocr = MenuItem::with_id(app, "ocr", tr(Text::MenuOcr), true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "logs", tr(Text::MenuLogs), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", tr(Text::MenuQuit), true, None::<&str>)?;
    let hint = MenuItem::with_id(app, "hint", hint_text(ctrl.shortcut().as_deref()), false, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &hint,
            &PredefinedMenuItem::separator(app)?,
            &ocr,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &logs,
            &quit,
        ],
    )?;
    app.manage(Items {
        hint,
        ocr,
        settings,
        logs,
        quit,
    });

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(tr(Text::AppName))
        .menu(&menu)
        .show_menu_on_left_click(true);
    builder = builder.icon(tray_icon()?);
    // A template image is recoloured by macOS to match the menu bar (light, dark, highlighted).
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }
    builder
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "ocr" => {
                if let Err(e) = ctrl.start_ocr() {
                    eprintln!("[pointer] ocr: {e}");
                }
            }
            "settings" => {
                if let Err(e) = crate::settings_window::open(app, None) {
                    eprintln!("[pointer] 打开设置失败：{e}");
                }
            }
            "logs" => {
                if let Some(dir) = &ctrl.log.dir {
                    let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// The tray glyph, rendered from `icons/tray/*.svg` by `scripts/tray-icons.mjs`.
/// macOS: a black-and-alpha template at 36px (18pt @2x). Windows/Linux: the full-colour app tile.
fn tray_icon() -> tauri::Result<tauri::image::Image<'static>> {
    #[cfg(target_os = "macos")]
    let bytes: &[u8] = include_bytes!("../icons/tray/tray-template@2x.png");
    #[cfg(not(target_os = "macos"))]
    let bytes: &[u8] = include_bytes!("../icons/tray/tray-windows.png");
    tauri::image::Image::from_bytes(bytes)
}

/// Relabels the menu and tooltip in the current language, with the hint showing `shortcut`.
pub fn refresh(app: &AppHandle, shortcut: Option<&str>) {
    if let Some(items) = app.try_state::<Items>() {
        let _ = items.hint.set_text(hint_text(shortcut));
        let _ = items.ocr.set_text(tr(Text::MenuOcr));
        let _ = items.settings.set_text(tr(Text::MenuSettings));
        let _ = items.logs.set_text(tr(Text::MenuLogs));
        let _ = items.quit.set_text(tr(Text::MenuQuit));
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(tr(Text::AppName)));
    }
}

fn hint_text(shortcut: Option<&str>) -> String {
    match shortcut {
        Some(s) => i18n::hint_with_shortcut(&display_shortcut(s)),
        None => tr(Text::HintNoShortcut).into(),
    }
}

/// `Alt+Backquote` → `⌥ + `` ` `` on macOS, `Alt + `` ` `` elsewhere. Mirrors
/// `formatShortcut` in `src/settings/shortcut.ts`.
fn display_shortcut(accelerator: &str) -> String {
    let mac = cfg!(target_os = "macos");
    accelerator
        .split('+')
        .map(|token| match token {
            "Alt" | "Option" => (if mac { "⌥" } else { "Alt" }).to_string(),
            "Shift" => (if mac { "⇧" } else { "Shift" }).to_string(),
            "Control" | "Ctrl" => (if mac { "⌃" } else { "Ctrl" }).to_string(),
            "Super" | "Command" | "Cmd" => (if mac { "⌘" } else { "Win" }).to_string(),
            key => key_label(key),
        })
        .collect::<Vec<_>>()
        .join(" + ")
}

fn key_label(code: &str) -> String {
    let symbol = match code {
        "Backquote" => "`",
        "Minus" => "-",
        "Equal" => "=",
        "BracketLeft" => "[",
        "BracketRight" => "]",
        "Backslash" => "\\",
        "Semicolon" => ";",
        "Quote" => "'",
        "Comma" => ",",
        "Period" => ".",
        "Slash" => "/",
        "Space" => tr(Text::KeySpace),
        "ArrowUp" => "↑",
        "ArrowDown" => "↓",
        "ArrowLeft" => "←",
        "ArrowRight" => "→",
        _ => "",
    };
    if !symbol.is_empty() {
        return symbol.into();
    }
    code.strip_prefix("Key")
        .or_else(|| code.strip_prefix("Digit"))
        .unwrap_or(code)
        .to_string()
}
