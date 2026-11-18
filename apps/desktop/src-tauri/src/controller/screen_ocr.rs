//! Screen OCR (macOS Vision): the region picker, the staged result and the crop lightbox.
//!
//! `start_ocr` and `close_ocr_lightbox` also run on the main thread (tray menu, shortcuts), so
//! `ocr` is only ever held briefly and never while waiting for the main thread.

use std::sync::atomic::Ordering;
use std::time::Instant;

use serde_json::json;
use tauri::Manager;

use super::{on_main, on_main_wait, overlay_window, Controller, ShowPayload, Size, Trigger};
use crate::env::AppInfo;
use crate::geometry::{Display, Point, Rect};
use crate::log::ms;
use crate::platform;

/// Staged OCR result: recognize returns a preview for ghost-box cascade; present opens the overlay.
struct PendingOcr {
    token: u64,
    text: String,
    confidence: f32,
    image_data_url: String,
    boxes: Vec<crate::ocr::OcrBox>,
    display: Display,
    logical: Rect,
    started: Instant,
    capture_ms: f64,
}

pub(super) struct OcrState {
    /// Vision recognition language pref: `system` / `zh-Hans` / `en-US`.
    pub(super) language: String,
    /// Display the OCR picker is covering (native top-left work area).
    picker: Option<Display>,
    /// Filled by `complete_ocr` until `present_ocr` (or cancel) consumes it.
    pending: Option<PendingOcr>,
    /// Crop image shown in the separate OCR lightbox window.
    lightbox_image: Option<String>,
}

impl Default for OcrState {
    fn default() -> Self {
        OcrState {
            language: "system".into(),
            picker: None,
            pending: None,
            lightbox_image: None,
        }
    }
}

impl Controller {
    pub(super) fn ocr_picking(&self) -> bool {
        self.ocr.lock().unwrap().picker.is_some()
    }

    pub(super) fn lightbox_open(&self) -> bool {
        self.ocr.lock().unwrap().lightbox_image.is_some()
    }

    /// Opens the region picker on the display under the cursor (macOS Vision path).
    pub fn start_ocr(&self) -> Result<(), String> {
        #[cfg(not(target_os = "macos"))]
        {
            Err("ocr-unsupported".into())
        }
        #[cfg(target_os = "macos")]
        {
            let at = platform::cursor_position(&self.app).ok_or("no cursor")?;
            let display = platform::display_at(&self.app, at).ok_or("no display")?;
            // Dismiss the live overlay so it is not captured into the screenshot.
            let (session, visible) = {
                let st = self.session.lock().unwrap();
                (st.session, st.visible)
            };
            if visible {
                self.emit_dismiss(session, "outside");
            }
            self.ocr.lock().unwrap().picker = Some(display);
            // Invalidate any leftover complete from a previous capture.
            self.ocr_token.fetch_add(1, Ordering::SeqCst);
            // Esc cancels the picker.
            self.sync_panel_escape();
            crate::ocr::open_picker(&self.app, display.area())
        }
    }

    pub fn cancel_ocr(&self) {
        self.ocr_token.fetch_add(1, Ordering::SeqCst);
        {
            let mut ocr = self.ocr.lock().unwrap();
            ocr.picker = None;
            ocr.pending = None;
        }
        crate::ocr::close_picker(&self.app);
        self.sync_panel_escape();
    }

    /// `region` is logical pixels relative to the picker (= work-area top-left).
    /// Keeps the picker visible (selection + mask stay on screen) while Vision runs. The picker
    /// window is `NSWindowSharingNone`, so capture skips the overlay and the crop stays clean.
    /// Call [`Self::present_ocr`] after the frontend ghost-box cascade.
    /// Esc bumps `ocr_token` and this returns `ocr-cancelled`.
    pub fn complete_ocr(&self, region: Rect) -> Result<crate::ocr::OcrPreview, String> {
        let (display, languages, token) = {
            let ocr = self.ocr.lock().unwrap();
            let display = ocr.picker.ok_or("ocr picker is not open")?;
            (
                display,
                vision_languages(&ocr.language),
                self.ocr_token.load(Ordering::SeqCst),
            )
        };

        if self.ocr_token.load(Ordering::SeqCst) != token {
            return Err("ocr-cancelled".into());
        }

        let native = display.rect_to_native(region);
        let started = Instant::now();
        // Picker stays up; errors surface in the still-visible picker UI (no hide/show flash).
        let outcome = crate::ocr::recognize_region(native, &languages)?;
        if self.ocr_token.load(Ordering::SeqCst) != token {
            return Err("ocr-cancelled".into());
        }
        let capture_ms = ms(started.elapsed());
        let logical = display.rect_to_logical(native);
        let preview = crate::ocr::OcrPreview {
            boxes: outcome.boxes.clone(),
            confidence: outcome.confidence,
        };
        self.ocr.lock().unwrap().pending = Some(PendingOcr {
            token,
            text: outcome.text,
            confidence: outcome.confidence,
            image_data_url: outcome.image_data_url,
            boxes: outcome.boxes,
            display,
            logical,
            started,
            capture_ms,
        });
        Ok(preview)
    }

    /// Consume the staged OCR result and open the overlay (after the ghost-box cascade).
    pub fn present_ocr(&self) -> Result<(), String> {
        let token = self.ocr_token.load(Ordering::SeqCst);
        let pending = {
            let mut ocr = self.ocr.lock().unwrap();
            let pending = ocr.pending.take().ok_or("ocr-no-pending")?;
            if pending.token != token {
                return Err("ocr-cancelled".into());
            }
            ocr.picker = None;
            pending
        };
        crate::ocr::close_picker(&self.app);
        self.sync_panel_escape();

        let id = self.latest_job.fetch_add(1, Ordering::SeqCst) + 1;
        let (width, height) = pending.display.logical_size();
        let mouse = Point {
            x: pending.logical.x + pending.logical.width / 2.0,
            y: pending.logical.y + pending.logical.height / 2.0,
        };
        let chars = pending.text.chars().count();
        let ui_language = self.begin_session(id, pending.started, pending.display);
        self.log.record(
            "capture",
            json!({
                "session": id, "ok": true, "gesture": "ocr", "method": "ocr",
                "captureMs": pending.capture_ms, "chars": chars,
                "confidence": pending.confidence, "hasBounds": true,
                "boxes": pending.boxes.len(),
            }),
        );
        self.emit_show(ShowPayload {
            session: id,
            trigger: Trigger::Shortcut,
            gesture: "ocr",
            ui_language,
            pointer_events: platform::POINTER_EVENTS,
            platform: std::env::consts::OS,
            work_area: Size { width, height },
            mouse,
            selection_rect: Some(pending.logical).filter(|b| !b.is_empty()),
            text: pending.text,
            context_before: None,
            context_after: None,
            app: AppInfo::default(),
            capture_ms: pending.capture_ms,
            method: "ocr",
            ocr_image: Some(pending.image_data_url),
        });
        Ok(())
    }

    /// Open a separate fullscreen lightbox for an OCR crop. Does not resize the overlay
    /// (avoids stage translate racing native setFrame and jumping the panel).
    ///
    /// On macOS the window is an NSPanel placed with `platform::set_frame_of` (same path as the
    /// overlay), so LogicalPosition quirks cannot shrink it into a small white card.
    pub fn open_ocr_lightbox(&self, image: String) -> Result<(), String> {
        let picker = {
            let mut ocr = self.ocr.lock().unwrap();
            ocr.lightbox_image = Some(image.clone());
            ocr.picker
        };
        let session = self.session.lock().unwrap().display;
        // display_at waits for the main thread on macOS, so no lock may be held here.
        let display = session
            .or(picker)
            .or_else(|| platform::cursor_position(&self.app).and_then(|at| platform::display_at(&self.app, at)))
            .ok_or_else(|| "no display for lightbox".to_string())?;
        let frame = Rect {
            width: display.width.max(1.0),
            height: display.height.max(1.0),
            ..display.area()
        };
        let label = crate::ocr::LIGHTBOX;
        let existed = self.app.get_webview_window(label).is_some();
        if existed {
            on_main(&self.app, move |app| {
                platform::set_frame_of(app, label, frame);
                platform::show_of(app, label);
                platform::set_keyboard_focus_of(app, label, true);
            })
            .ok_or("main thread did not respond")?;
        } else {
            // No timeout: the lightbox is reused by label, so it must not be left half made.
            on_main_wait(&self.app, move |app| {
                platform::with_no_activate(|| -> Result<(), String> {
                    let window = overlay_window(app, label, "Pointer").map_err(|e| e.to_string())?;
                    // Place while converting to NSPanel so we never flash at the builder's (0,0).
                    platform::setup_overlay_with_frame(app, &window, Some(frame)).map_err(|e| e.to_string())?;
                    // Linux/Windows setup is a no-op for frame — always set explicitly.
                    platform::set_frame_of(app, label, frame);
                    platform::show_of(app, label);
                    // OverlayKeyPanel so Esc reaches the webview without activating the app.
                    platform::set_keyboard_focus_of(app, label, true);
                    Ok(())
                })
            })
            .ok_or_else(|| "main thread did not respond".to_string())??;
        }
        // Peek covers first-load race; emit for already-mounted listeners.
        crate::ocr::emit_lightbox_show(&self.app, Some(&image));
        Ok(())
    }

    pub fn lightbox_image(&self) -> Option<String> {
        self.ocr.lock().unwrap().lightbox_image.clone()
    }

    pub fn close_ocr_lightbox(&self) {
        self.ocr.lock().unwrap().lightbox_image = None;
        crate::ocr::emit_lightbox_show(&self.app, None);
        let label = crate::ocr::LIGHTBOX;
        let _ = on_main(&self.app, move |app| {
            platform::set_keyboard_focus_of(app, label, false);
            platform::hide_of(app, label);
        });
    }
}

fn vision_languages(pref: &str) -> Vec<String> {
    match pref {
        "zh-Hans" => vec!["zh-Hans".into(), "en-US".into()],
        "en-US" => vec!["en-US".into()],
        _ => Vec::new(), // empty → automaticallyDetectsLanguage on macOS
    }
}
