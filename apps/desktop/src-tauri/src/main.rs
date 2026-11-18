#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// The Linux stub leaves most capture helpers unused.
#![cfg_attr(target_os = "linux", allow(dead_code))]

mod commands;
mod controller;
mod env;
mod geometry;
mod i18n;
mod log;
mod ocr;
mod pins;
mod platform;
mod prefs;
mod secrets;
mod settings_window;
mod tray;

use std::sync::Arc;

use tauri::Manager;

use controller::{Controller, OVERLAY};

fn main() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if let Some(ctrl) = app.try_state::<Arc<Controller>>() {
                        ctrl.handle_shortcut(shortcut, event);
                    }
                })
                .build(),
        );
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            commands::overlay_present,
            commands::overlay_set_hit,
            commands::overlay_set_frame,
            commands::overlay_painted,
            commands::overlay_hide,
            commands::overlay_engage,
            commands::pin_open,
            commands::pin_init,
            commands::pin_show,
            commands::pin_painted,
            commands::pin_resize,
            commands::pin_drag,
            commands::pin_engage,
            commands::pin_close,
            commands::pin_cancel,
            commands::pin_set_fixed,
            commands::set_trigger_shortcut,
            commands::pause_trigger_shortcut,
            commands::set_ocr_shortcut,
            commands::ocr_start,
            commands::ocr_complete,
            commands::ocr_present,
            commands::ocr_cancel,
            commands::ocr_screen_permission,
            commands::ocr_request_screen_permission,
            commands::ocr_open_screen_settings,
            commands::accessibility_permission,
            commands::accessibility_request,
            commands::accessibility_open_settings,
            commands::ocr_lightbox_open,
            commands::ocr_lightbox_peek,
            commands::ocr_lightbox_close,
            commands::recent_apps,
            commands::autostart_enabled,
            commands::set_autostart,
            secrets::secret_get,
            secrets::secret_set,
            secrets::secret_delete,
            settings_window::open_settings,
            settings_window::open_logs,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if !platform::ensure_permissions() {
                eprintln!("[pointer] 还没有辅助功能权限：请在系统设置里授权后重启原型");
            }

            // Same no-activate wrap as pin_open: creating the window must not activate us.
            let _window = platform::with_no_activate(|| {
                let window = controller::overlay_window(app.handle(), OVERLAY, "Pointer Overlay")?;
                platform::setup_overlay(app.handle(), &window)?;
                Ok::<_, tauri::Error>(window)
            })?;

            let ctrl = Controller::start(app.handle());
            app.manage(ctrl.clone());
            ctrl.apply_prefs(prefs::load(app.handle()));
            let c = ctrl.clone();
            prefs::watch(app.handle(), move |p| c.apply_prefs(p));
            tray::build(app, ctrl)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
