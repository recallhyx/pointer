//! Turns global mouse events into sessions: detect a selection gesture, capture the selection on
//! a worker thread, tell the overlay to show, then capture the environment in parallel.
//! The overlay webview owns placement and animation; this side owns timing, hit-testing for
//! click-through, and the diagnostics log.
//!
//! State is split by concern, each part behind its own lock: the session (`session`), settings
//! (`config`), shortcuts (`shortcuts`), pinned panels (`pinned`) and screen OCR (`ocr`).
//!
//! Locking rules:
//! - Never wait for the main thread (`on_main`, shortcut registration, Windows `hwnd()`) while
//!   holding a lock the main thread takes. The main thread (shortcut handler, tray menu) takes
//!   `session`, `ocr`, `config` and the shortcuts' state, briefly.
//! - `click_through` and `pinned` are never taken on the main thread, so they may be held while
//!   toggling click-through. Lock order: `click_through` before `session`.

mod pinned;
mod screen_ocr;
mod shortcuts;

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutEvent, ShortcutState};

use crate::env::{self, AppInfo, Environment};
use crate::geometry::{Display, Point, Rect};
use crate::i18n::{self, Lang};
use crate::log::{ms, Log};
use crate::platform::{self, Capture, CaptureError, MouseEvent};
use crate::prefs::Prefs;

use pinned::Pinned;
use screen_ocr::OcrState;
use shortcuts::{escape_shortcut, Kind, Shortcuts};

pub const OVERLAY: &str = "overlay";
/// Pinned panels are labelled `pinned-<n>` (capabilities match `pinned-*`).
pub const PINNED_PREFIX: &str = "pinned-";

/// The overlay window and every pinned panel share one configuration: transparent, borderless,
/// always on top, never activating. `platform::setup_overlay` finishes the per-OS part.
pub fn overlay_window(app: &AppHandle, label: &str, title: &str) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(320.0, 200.0)
        .position(0.0, 0.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .focused(false)
        .focusable(false)
        .accept_first_mouse(true)
        .visible(false)
        .build()
}

/// Movement between mouse down and up (in native units) that counts as a drag selection.
const DRAG_THRESHOLD: f64 = 5.0;
/// Give up on a capture after this long (CONTEXT.md: 浮标).
const CAPTURE_DEADLINE: Duration = Duration::from_millis(400);
const POINTER_INTERVAL: Duration = Duration::from_millis(8);
/// Host apps remembered for the excluded-apps page.
const RECENT_APPS: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Trigger {
    Auto,
    Shortcut,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ShowPayload {
    session: u64,
    trigger: Trigger,
    gesture: &'static str,
    ui_language: String,
    pointer_events: bool,
    platform: &'static str,
    work_area: Size,
    mouse: Point,
    selection_rect: Option<Rect>,
    text: String,
    context_before: Option<String>,
    context_after: Option<String>,
    app: AppInfo,
    capture_ms: f64,
    method: &'static str,
    /// Cropped OCR screenshot as a data URL; null for non-OCR captures.
    #[serde(skip_serializing_if = "Option::is_none")]
    ocr_image: Option<String>,
}

#[derive(Serialize, Clone, Copy)]
struct Size {
    width: f64,
    height: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EnvPayload {
    session: u64,
    environment: Environment,
    env_ms: f64,
}

#[derive(Serialize, Clone)]
struct DismissPayload {
    session: u64,
    reason: &'static str,
}

struct CaptureJob {
    id: u64,
    at: Point,
    started: Instant,
    trigger: Trigger,
    gesture: &'static str,
}

struct EnvJob {
    id: u64,
    app: AppInfo,
    started: Instant,
}

/// The overlay session and the pointer.
struct SessionState {
    session: u64,
    session_started: Option<Instant>,
    latency_logged: bool,
    visible: bool,
    display: Option<Display>,
    hit: Option<Rect>,
    pointer: Point,
    last_pointer_emit: Instant,
    left_down: Option<(Point, bool)>,
    /// The user is typing a follow-up (CONTEXT.md 驻留): outside clicks and new selections are
    /// ignored and the overlay holds keyboard focus.
    engaged: bool,
    /// Single keyboard owner for detached panels; readable from main-thread shortcut handlers.
    pinned_engaged: Option<String>,
    /// An unpinned panel keeps its existing webview, but follows temporary-overlay rules.
    temporary_panel: Option<crate::pins::TemporaryPanel>,
}

impl SessionState {
    fn over_overlay(&self, p: Point) -> bool {
        self.visible && self.hit.is_some_and(|h| h.contains(p))
    }

    fn needs_escape(&self, ocr_picking: bool) -> bool {
        ocr_picking
            || (!(self.engaged || self.pinned_engaged.is_some()) && (self.visible || self.temporary_panel.is_some()))
    }

    fn focus_pin(&mut self, label: &str) {
        self.engaged = false;
        self.pinned_engaged = Some(label.to_string());
        if let Some(panel) = &mut self.temporary_panel {
            panel.engaged = panel.label == label;
        }
    }
}

/// The settings the capture side acts on.
struct Config {
    /// The `uiLanguage` setting as written: `zh`, `en`, `ja`, `ko`, `es`, `fr` or `system`.
    ui_language: String,
    auto_trigger: bool,
    /// Copy the selection via the clipboard when accessibility finds no text.
    clipboard_fallback: bool,
    /// Lowercased app ids.
    excluded: Vec<String>,
}

pub struct Controller {
    app: AppHandle,
    session: Mutex<SessionState>,
    /// Whether the overlay passes clicks through. Held while toggling it.
    click_through: Mutex<bool>,
    config: Mutex<Config>,
    shortcuts: Shortcuts,
    pinned: Mutex<Pinned>,
    ocr: Mutex<OcrState>,
    recent_apps: Mutex<VecDeque<AppInfo>>,
    latest_job: AtomicU64,
    /// Bumped on cancel/start so an in-flight complete_ocr will not emit.
    ocr_token: AtomicU64,
    capture_tx: mpsc::Sender<CaptureJob>,
    env_tx: mpsc::Sender<EnvJob>,
    pub log: Log,
}

/// Runs `f` on the main thread and waits for the result. Never call from the main thread.
///
/// Gives up after 500ms, but `f` still runs once the main thread gets to it; use
/// [`on_main_wait`] when its effect must be accounted for (creating a window).
pub fn on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(&AppHandle) -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(f(&handle));
    })
    .ok()?;
    rx.recv_timeout(Duration::from_millis(500)).ok()
}

/// Like [`on_main`] but waits as long as it takes. For window creation: a cold WebView can take
/// longer than 500ms, and giving up then left a window nothing tracked or ever destroyed.
/// Callers run on command or worker threads, never under a lock the main thread takes.
pub fn on_main_wait<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(&AppHandle) -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(f(&handle));
    })
    .ok()?;
    rx.recv().ok()
}

impl Controller {
    pub fn start(app: &AppHandle) -> Arc<Controller> {
        let (capture_tx, capture_rx) = mpsc::channel::<CaptureJob>();
        let (env_tx, env_rx) = mpsc::channel::<EnvJob>();
        let (mouse_tx, mouse_rx) = mpsc::channel::<MouseEvent>();

        let ctrl = Arc::new(Controller {
            app: app.clone(),
            session: Mutex::new(SessionState {
                session: 0,
                session_started: None,
                latency_logged: true,
                visible: false,
                display: None,
                hit: None,
                pointer: Point::default(),
                last_pointer_emit: Instant::now(),
                left_down: None,
                engaged: false,
                pinned_engaged: None,
                temporary_panel: None,
            }),
            click_through: Mutex::new(false),
            config: Mutex::new(Config {
                ui_language: "system".into(),
                auto_trigger: true,
                clipboard_fallback: true,
                excluded: Vec::new(),
            }),
            shortcuts: Shortcuts::new(app),
            pinned: Mutex::default(),
            ocr: Mutex::default(),
            recent_apps: Mutex::default(),
            latest_job: AtomicU64::new(0),
            ocr_token: AtomicU64::new(0),
            capture_tx,
            env_tx,
            log: Log::open(app.path().app_log_dir().ok()),
        });

        let c = ctrl.clone();
        thread::Builder::new()
            .name("capture".into())
            .spawn(move || {
                let mut capturer = platform::Capturer::new();
                for job in capture_rx {
                    if job.id != c.latest_job.load(Ordering::SeqCst) {
                        continue;
                    }
                    let (excluded, clipboard_fallback) = {
                        let config = c.config.lock().unwrap();
                        (config.excluded.clone(), config.clipboard_fallback)
                    };
                    let skip = |app: &AppInfo| job.trigger == Trigger::Auto && is_excluded(&excluded, app);
                    let mut result = capturer.selection(job.started + CAPTURE_DEADLINE, skip);
                    // Only the shortcut may press Copy (CONTEXT.md: 取词方式). An auto trigger
                    // that reads no text was not a selection (dragging a file or a window), and
                    // copying then would put noise in clipboard managers.
                    if clipboard_fallback && job.trigger == Trigger::Shortcut {
                        if let Err(e) = &result {
                            if let Some(ax) = e.ax_diagnostics() {
                                c.log.record(
                                    "capture-ax-failure",
                                    json!({
                                        "session": job.id, "error": e.code(),
                                        "app": e.app().and_then(|a| a.name.clone()),
                                        "appId": e.app().and_then(|a| a.id.clone()),
                                        "ax": ax,
                                    }),
                                );
                            }
                        }
                        result = with_clipboard_fallback(&mut capturer, result, &excluded);
                    }
                    c.on_captured(job, result);
                }
            })
            .expect("spawn capture thread");

        let c = ctrl.clone();
        thread::Builder::new()
            .name("environment".into())
            .spawn(move || {
                let mut capturer = platform::Capturer::new();
                for job in env_rx {
                    let raw = capturer.environment(&job.app);
                    let environment = env::sanitize(raw);
                    c.on_environment(job, environment);
                }
            })
            .expect("spawn environment thread");

        let c = ctrl.clone();
        thread::Builder::new()
            .name("mouse-events".into())
            .spawn(move || {
                for ev in mouse_rx {
                    c.on_mouse(ev);
                }
            })
            .expect("spawn mouse thread");
        platform::start_mouse_listener(mouse_tx);

        ctrl
    }

    pub fn apply_prefs(&self, prefs: Prefs) {
        {
            let mut config = self.config.lock().unwrap();
            config.auto_trigger = prefs.auto_trigger;
            config.clipboard_fallback = prefs.clipboard_fallback;
            config.ui_language = prefs.ui_language.clone();
            config.excluded = prefs.excluded_apps.iter().map(|a| a.id.to_lowercase()).collect();
        }
        self.ocr.lock().unwrap().language = prefs.ocr_language.clone();
        i18n::set(Lang::resolve(&prefs.ui_language));
        if let Err(e) = self.shortcuts.apply(Kind::Trigger, prefs.shortcut.as_deref()) {
            eprintln!("[pointer] global shortcut: {e}");
        }
        if let Err(e) = self
            .shortcuts
            .apply(Kind::Ocr, ocr_accelerator(prefs.ocr_shortcut.as_deref()))
        {
            eprintln!("[pointer] ocr shortcut: {e}");
        }
        crate::tray::refresh(&self.app, self.shortcut().as_deref());
        crate::settings_window::retitle(&self.app);
    }

    /// The trigger shortcut as written in the settings file, if one is set.
    pub fn shortcut(&self) -> Option<String> {
        self.shortcuts.accelerator(Kind::Trigger)
    }

    /// Replaces the trigger shortcut and ends a pause. If the new one cannot be registered (usually
    /// because another app holds it) the old one stays.
    pub fn set_shortcut(&self, accelerator: Option<&str>) -> Result<(), String> {
        let result = self.shortcuts.set(Kind::Trigger, accelerator);
        crate::tray::refresh(&self.app, self.shortcut().as_deref());
        result
    }

    /// Replaces the screen-OCR shortcut and ends a pause, like [`Self::set_shortcut`].
    pub fn set_ocr_shortcut(&self, accelerator: Option<&str>) -> Result<(), String> {
        self.shortcuts.set(Kind::Ocr, ocr_accelerator(accelerator))
    }

    /// Lets the settings window record a new shortcut without the current ones firing.
    pub fn pause_shortcut(&self, paused: bool) {
        self.shortcuts.pause(paused);
    }

    pub fn recent_apps(&self) -> Vec<AppInfo> {
        self.recent_apps.lock().unwrap().iter().cloned().collect()
    }

    fn remember_app(&self, app: &AppInfo) {
        let Some(id) = &app.id else { return };
        let mut recent = self.recent_apps.lock().unwrap();
        recent.retain(|a| a.id.as_ref() != Some(id));
        recent.push_front(app.clone());
        recent.truncate(RECENT_APPS);
    }

    fn pointer(&self) -> Point {
        self.session.lock().unwrap().pointer
    }

    fn on_mouse(&self, ev: MouseEvent) {
        match ev {
            MouseEvent::LeftDown(p) => {
                self.temporary_pin_left_down(p);
                self.pins_left_down(p);
                let lightbox = self.lightbox_open();
                let mut st = self.session.lock().unwrap();
                let on_overlay = st.over_overlay(p);
                st.left_down = Some((p, on_overlay));
                // Lightbox dim is outside the overlay hit; frontend closes only the lightbox.
                if !lightbox && st.visible && !st.engaged && !on_overlay {
                    self.emit_dismiss(st.session, "outside");
                }
            }
            MouseEvent::OtherDown(p) => {
                if self.lightbox_open() {
                    return;
                }
                self.temporary_pin_left_down(p);
                let st = self.session.lock().unwrap();
                if st.visible && !st.engaged && !st.over_overlay(p) {
                    self.emit_dismiss(st.session, "outside");
                }
            }
            MouseEvent::LeftUp { at, clicks, shift } => {
                let (down, on_overlay, engaged) = {
                    let mut st = self.session.lock().unwrap();
                    (
                        st.left_down.take(),
                        st.over_overlay(at),
                        st.engaged || st.temporary_panel.as_ref().is_some_and(|p| p.engaged),
                    )
                };
                if let Some(label) = self.pin_drag_end() {
                    self.pin_settle(&label);
                    return;
                }
                // Dim/backdrop click must not start a new capture under the lightbox.
                if self.lightbox_open() {
                    return;
                }
                // Selecting or double-clicking inside a pinned panel is not a new selection.
                if !on_overlay && self.pin_hit(at) {
                    return;
                }
                if on_overlay || down.is_some_and(|(_, on_overlay)| on_overlay) {
                    return;
                }
                let dragged = down.is_some_and(|(p, _)| p.distance(at) >= DRAG_THRESHOLD);
                let gesture = if dragged {
                    "drag"
                } else if clicks >= 3 {
                    "triple-click"
                } else if clicks == 2 {
                    "double-click"
                } else if shift {
                    "shift-click"
                } else {
                    return;
                };
                if !self.config.lock().unwrap().auto_trigger || engaged {
                    return;
                }
                self.request_capture(at, Trigger::Auto, gesture);
            }
            MouseEvent::Move(p) => {
                let (over_overlay, emit, visible) = {
                    let mut st = self.session.lock().unwrap();
                    st.pointer = p;
                    (
                        st.over_overlay(p),
                        st.last_pointer_emit.elapsed() >= POINTER_INTERVAL,
                        st.visible,
                    )
                };
                self.track_pins(p, over_overlay, emit);
                if !visible {
                    return;
                }
                self.sync_click_through();
                if emit {
                    let display = {
                        let mut st = self.session.lock().unwrap();
                        st.last_pointer_emit = Instant::now();
                        st.display
                    };
                    if let Some(d) = display {
                        let _ = self.app.emit_to(OVERLAY, "overlay://pointer", d.to_logical(p));
                    }
                }
            }
            MouseEvent::Wheel => {
                let st = self.session.lock().unwrap();
                if st.visible {
                    let _ = self.app.emit_to(OVERLAY, "overlay://wheel", st.session);
                }
            }
        }
    }

    /// Lets clicks through the overlay everywhere but its surface. On Windows toggling it waits
    /// for the main thread, so `session` is released first; `click_through` keeps the decision
    /// and the toggle in order.
    fn sync_click_through(&self) {
        if !platform::POINTER_EVENTS {
            return;
        }
        let mut ignoring = self.click_through.lock().unwrap();
        let want = {
            let st = self.session.lock().unwrap();
            if !st.visible {
                return;
            }
            !st.over_overlay(st.pointer)
        };
        if want != *ignoring {
            *ignoring = want;
            platform::set_ignore_cursor(&self.app, want);
        }
    }

    pub fn request_capture(&self, at: Point, trigger: Trigger, gesture: &'static str) {
        let id = self.latest_job.fetch_add(1, Ordering::SeqCst) + 1;
        let _ = self.capture_tx.send(CaptureJob {
            id,
            at,
            started: Instant::now(),
            trigger,
            gesture,
        });
    }

    /// Makes `id` the current session; returns the UI language for its show payload.
    fn begin_session(&self, id: u64, started: Instant, display: Display) -> String {
        self.dismiss_temporary_pin("selection");
        {
            let mut st = self.session.lock().unwrap();
            st.session = id;
            st.session_started = Some(started);
            st.latency_logged = false;
            st.display = Some(display);
        }
        self.config.lock().unwrap().ui_language.clone()
    }

    fn emit_show(&self, payload: ShowPayload) {
        let _ = self.app.emit_to(OVERLAY, "overlay://show", payload);
    }

    fn on_captured(&self, job: CaptureJob, result: Result<Capture, CaptureError>) {
        let capture_ms = ms(job.started.elapsed());
        match &result {
            Ok(c) => self.log.record(
                "capture",
                json!({
                    "session": job.id, "ok": true, "gesture": job.gesture, "method": c.method,
                    "app": c.app.name, "appId": c.app.id, "captureMs": capture_ms,
                    "chars": c.text.chars().count(), "hasBounds": c.bounds.is_some(),
                    "hasContext": c.context_before.is_some() || c.context_after.is_some(),
                }),
            ),
            Err(CaptureError::OwnApp) => return,
            Err(e) => self.log.record(
                "capture",
                json!({
                    "session": job.id, "ok": false, "gesture": job.gesture, "error": e.code(),
                    "app": e.app().and_then(|a| a.name.clone()), "appId": e.app().and_then(|a| a.id.clone()),
                    "captureMs": capture_ms,
                    "ax": e.ax_diagnostics(),
                }),
            ),
        }
        if let Some(app) = match &result {
            Ok(c) => Some(&c.app),
            Err(e) => e.app(),
        } {
            self.remember_app(app);
        }
        let Ok(mut capture) = result else { return };
        if job.id != self.latest_job.load(Ordering::SeqCst) {
            return;
        }
        // An excluded app only gets here through the shortcut; send nothing beyond the selection
        // and the app name (CONTEXT.md: 上下文).
        let excluded = is_excluded(&self.config.lock().unwrap().excluded, &capture.app);
        if excluded {
            capture.context_before = None;
            capture.context_after = None;
        }
        let Some(display) = platform::display_at(&self.app, job.at) else {
            return;
        };
        let (width, height) = display.logical_size();
        let ui_language = self.begin_session(job.id, job.started, display);
        self.emit_show(ShowPayload {
            session: job.id,
            trigger: job.trigger,
            gesture: job.gesture,
            ui_language,
            pointer_events: platform::POINTER_EVENTS,
            platform: std::env::consts::OS,
            work_area: Size { width, height },
            mouse: display.to_logical(job.at),
            selection_rect: capture
                .bounds
                .filter(|b| !b.is_empty())
                .map(|b| display.rect_to_logical(b)),
            text: capture.text,
            context_before: capture.context_before,
            context_after: capture.context_after,
            app: capture.app.clone(),
            capture_ms,
            method: capture.method,
            ocr_image: None,
        });
        if excluded {
            let environment = Environment {
                app_name: capture.app.name.clone(),
                ..Default::default()
            };
            let _ = self.app.emit_to(
                OVERLAY,
                "overlay://env",
                EnvPayload {
                    session: job.id,
                    environment,
                    env_ms: 0.0,
                },
            );
            return;
        }
        let _ = self.env_tx.send(EnvJob {
            id: job.id,
            app: capture.app,
            started: Instant::now(),
        });
    }

    fn on_environment(&self, job: EnvJob, environment: Environment) {
        let env_ms = ms(job.started.elapsed());
        self.log.record(
            "environment",
            json!({
                "session": job.id, "appId": job.app.id, "envMs": env_ms,
                "hasTitle": environment.window_title.is_some(), "hasUrl": environment.url.is_some(),
                "hasDocument": environment.document_name.is_some(),
            }),
        );
        let _ = self.app.emit_to(
            OVERLAY,
            "overlay://env",
            EnvPayload {
                session: job.id,
                environment,
                env_ms,
            },
        );
    }

    fn emit_dismiss(&self, session: u64, reason: &'static str) {
        let _ = self
            .app
            .emit_to(OVERLAY, "overlay://dismiss", DismissPayload { session, reason });
    }

    fn current_display(&self, session: u64) -> Result<Display, String> {
        let st = self.session.lock().unwrap();
        if st.session != session {
            return Err(format!("stale session {session}, current is {}", st.session));
        }
        st.display.ok_or_else(|| "no display".into())
    }

    pub fn present(&self, session: u64, frame: Rect, hit: Rect) -> Result<(), String> {
        let display = self.current_display(session)?;
        let frame = display.rect_to_native(frame);
        let mut ignoring = self.click_through.lock().unwrap();
        let ignore = {
            let mut st = self.session.lock().unwrap();
            st.hit = Some(display.rect_to_native(hit));
            st.visible = true;
            st.engaged = false;
            platform::POINTER_EVENTS && !st.over_overlay(st.pointer)
        };
        *ignoring = ignore;
        on_main(&self.app, move |app| {
            platform::set_frame(app, frame);
            platform::set_ignore_cursor(app, ignore);
            platform::show(app);
        })
        .ok_or("main thread did not respond")?;
        drop(ignoring);
        self.sync_panel_escape();
        Ok(())
    }

    pub fn set_hit(&self, session: u64, hit: Rect) -> Result<(), String> {
        let hit = self.current_display(session)?.rect_to_native(hit);
        self.session.lock().unwrap().hit = Some(hit);
        self.sync_click_through();
        Ok(())
    }

    /// Resize the overlay window without resetting engage / escape (OCR lightbox expand).
    pub fn set_frame(&self, session: u64, frame: Rect) -> Result<(), String> {
        let display = self.current_display(session)?;
        let frame = display.rect_to_native(frame);
        on_main(&self.app, move |app| {
            platform::set_frame(app, frame);
        })
        .ok_or("main thread did not respond")?;
        Ok(())
    }

    /// Show latency = mouse-up (or shortcut) to the first frame with the bubble painted.
    pub fn painted(&self, session: u64) -> Option<f64> {
        let mut st = self.session.lock().unwrap();
        if st.session != session || st.latency_logged {
            return None;
        }
        st.latency_logged = true;
        let latency = ms(st.session_started?.elapsed());
        self.log
            .record("show", json!({ "session": session, "showLatencyMs": latency }));
        Some(latency)
    }

    pub fn hide(&self, session: u64) {
        let engaged = {
            let mut st = self.session.lock().unwrap();
            if st.session != session {
                return;
            }
            st.visible = false;
            st.hit = None;
            std::mem::take(&mut st.engaged)
        };
        on_main(&self.app, move |app| {
            if engaged {
                platform::set_keyboard_focus(app, false);
            }
            platform::hide(app);
        });
        self.sync_panel_escape();
        // Overlay was covering a pin: re-sync click-through without waiting for a mouse move.
        let (pointer, emit) = {
            let st = self.session.lock().unwrap();
            (st.pointer, st.last_pointer_emit.elapsed() >= POINTER_INTERVAL)
        };
        self.track_pins(pointer, false, emit);
    }

    /// The user clicked into the follow-up input (ADR 0002). Called again on every click there,
    /// since another app may have taken the focus back in between.
    pub fn engage(&self, session: u64) -> Result<(), String> {
        {
            let mut st = self.session.lock().unwrap();
            if st.session != session || !st.visible {
                return Err(format!("session {session} is not showing"));
            }
            st.engaged = true;
            st.pinned_engaged = None;
            if let Some(panel) = &mut st.temporary_panel {
                panel.engaged = false;
            }
        }
        // Esc goes to the overlay itself now, so an input method can still use it to cancel.
        self.sync_panel_escape();
        on_main(&self.app, platform::prepare_keyboard_focus).ok_or("main thread did not respond")?;
        Ok(())
    }

    /// Runs on the main thread, so it only takes locks the rules above allow there.
    pub fn handle_shortcut(&self, shortcut: &Shortcut, event: ShortcutEvent) {
        if event.state() != ShortcutState::Pressed {
            return;
        }
        let (session, engaged, temporary) = {
            let st = self.session.lock().unwrap();
            (
                st.session,
                st.engaged || st.temporary_panel.as_ref().is_some_and(|p| p.engaged),
                st.temporary_panel.clone(),
            )
        };
        if *shortcut == escape_shortcut() {
            if self.lightbox_open() {
                // Prefer closing the crop viewer; leave the OCR/Explain panel up.
                self.close_ocr_lightbox();
            } else if self.ocr_picking() {
                self.cancel_ocr();
            } else {
                if let Some(panel) = temporary {
                    let _ = self.app.emit_to(panel.label.as_str(), "pin://dismiss", "escape");
                }
                self.emit_dismiss(session, "escape");
            }
            return;
        }
        if engaged {
            return;
        }
        match self.shortcuts.kind_of(shortcut) {
            Some(Kind::Ocr) => {
                let _ = self.start_ocr();
            }
            Some(Kind::Trigger) => {
                if let Some(at) = platform::cursor_position(&self.app) {
                    self.request_capture(at, Trigger::Shortcut, "shortcut");
                }
            }
            None => {}
        }
    }
}

/// Screen OCR is macOS only (Vision); elsewhere its shortcut would hold a global hotkey that
/// does nothing, so it is left unregistered.
fn ocr_accelerator(accelerator: Option<&str>) -> Option<&str> {
    if cfg!(target_os = "macos") {
        accelerator
    } else {
        None
    }
}

/// When accessibility found the app but no text, asks the platform to copy the selection through
/// the clipboard. Excluded apps are never copied from, even through the shortcut.
fn with_clipboard_fallback(
    capturer: &mut platform::Capturer,
    result: Result<Capture, CaptureError>,
    excluded: &[String],
) -> Result<Capture, CaptureError> {
    let app = match &result {
        Err(e) if matches!(e.code(), "no-text" | "no-focused-element") => match e.app() {
            Some(app) => app,
            None => return result,
        },
        _ => return result,
    };
    if is_excluded(excluded, app) {
        return result;
    }
    match capturer.copy_selection() {
        Some(text) => Ok(Capture {
            text,
            context_before: None,
            context_after: None,
            bounds: None,
            app: app.clone(),
            method: "clipboard",
        }),
        None => result,
    }
}

fn is_excluded(excluded: &[String], app: &AppInfo) -> bool {
    app.id.as_ref().is_some_and(|id| excluded.contains(&id.to_lowercase()))
}

#[cfg(test)]
mod panel_state_tests {
    use super::*;
    use crate::pins::TemporaryPanel;

    fn state() -> SessionState {
        SessionState {
            session: 1,
            session_started: None,
            latency_logged: true,
            visible: false,
            display: None,
            hit: None,
            pointer: Point::default(),
            last_pointer_emit: Instant::now(),
            left_down: None,
            engaged: false,
            pinned_engaged: None,
            temporary_panel: Some(TemporaryPanel {
                label: "pinned-a".into(),
                engaged: false,
            }),
        }
    }

    #[test]
    fn cancelling_ocr_preserves_escape_for_a_temporary_panel() {
        let mut st = state();
        assert!(st.needs_escape(true));
        assert!(st.needs_escape(false));
        st.temporary_panel = None;
        assert!(!st.needs_escape(false));
        assert!(st.needs_escape(true));
    }

    #[test]
    fn focus_transfer_clears_previous_temporary_residency() {
        let mut st = state();
        st.engaged = true;
        st.focus_pin("pinned-a");
        assert!(!st.engaged);
        assert!(st.temporary_panel.as_ref().unwrap().engaged);
        assert!(!st.needs_escape(false));
        st.focus_pin("pinned-b");
        assert!(!st.temporary_panel.as_ref().unwrap().engaged);
        assert_eq!(st.pinned_engaged.as_deref(), Some("pinned-b"));
        st.pinned_engaged = None;
        assert!(st.needs_escape(false));
    }

    #[test]
    fn ocr_escape_overrides_keyboard_ownership_but_composition_does_not() {
        let mut st = state();
        st.engaged = true;
        assert!(!st.needs_escape(false));
        assert!(st.needs_escape(true));
    }
}
