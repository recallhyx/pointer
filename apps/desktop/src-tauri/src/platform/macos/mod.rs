mod accessibility;
mod ax;
pub(crate) mod ocr;
mod panel;
mod pasteboard;
mod tap;

use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::sync::mpsc::Sender;
use std::thread;
use std::time::{Duration, Instant};

use objc2::runtime::AnyObject;
use objc2::{msg_send, MainThreadMarker};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationPolicy, NSRunningApplication, NSScreen, NSWindowAnimationBehavior,
    NSWorkspace,
};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_nspanel::{CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt};

use self::panel::OverlayKeyPanel;

use self::ax::{CFRange, Element};
use super::accessible::{self, AxHost, EnableOutcome, ManualAccessibility};
use super::ax_diagnostics::{AxCall, AxCaptureDiagnostics};
use super::clipboard;
use super::{Capture, CaptureError, MouseEvent, CONTEXT_CHARS};
use crate::controller::{on_main, OVERLAY};
use crate::env::{self, AppInfo, Environment};
use crate::geometry::{Display, Point, Rect};

pub const POINTER_EVENTS: bool = true;

const AX_TIMEOUT_SECS: f32 = 0.25;
const RETRY_DELAY: Duration = Duration::from_millis(40);

pub fn ensure_permissions() -> bool {
    ax::is_trusted(true)
}

/// Checks without triggering the system prompt (used for settings-page polling).
pub fn accessibility_allowed() -> bool {
    ax::is_trusted(false)
}

/// Opens System Settings → Privacy → Accessibility (best-effort).
pub fn open_accessibility_settings() {
    // macOS 13+ moved Privacy & Security into an extension-backed pane; the legacy
    // `com.apple.preference.security` URL no longer lands there on macOS 14+ (confirmed
    // broken on macOS 26 Tahoe — it opens General Settings instead). Try the current scheme
    // first and fall back to the legacy one for older systems where it still works.
    let opened = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility")
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !opened {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .status();
    }
}

pub fn start_mouse_listener(tx: Sender<MouseEvent>) {
    tap::start(tx);
}

pub fn cursor_position(_app: &AppHandle) -> Option<Point> {
    tap::cursor_position()
}

pub struct Capturer {
    /// Apps we already asked to expose their accessibility tree.
    manual_accessibility: ManualAccessibility,
    enable_results: HashMap<i32, accessibility::EnableAttempt>,
}

/// The live macOS accessibility API behind [`AxHost`].
#[derive(Default)]
struct MacAx {
    focused_failure: RefCell<Option<AxCall>>,
    enable_result: RefCell<Option<(i32, accessibility::EnableAttempt)>>,
}

impl AxHost for MacAx {
    fn focused_app_pid(&self) -> Option<i32> {
        let system = Element::system_wide();
        system.set_timeout(AX_TIMEOUT_SECS);
        match system
            .element_result("AXFocusedApplication")
            .and_then(|app| app.pid_result())
        {
            Ok(pid) => Some(pid),
            Err(error) => {
                *self.focused_failure.borrow_mut() = Some(error);
                None
            }
        }
    }

    fn frontmost_pid(&self) -> Option<i32> {
        NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .map(|a| a.processIdentifier())
    }

    fn enable_accessibility(&self, pid: i32) -> EnableOutcome {
        let app = Element::application(pid);
        app.set_timeout(AX_TIMEOUT_SECS);
        let id = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
            .and_then(|running| running.bundleIdentifier())
            .map(|id| id.to_string());
        let result = accessibility::enable(
            id.as_deref(),
            |attribute| match app.set_bool_result(attribute, true) {
                Ok(()) => AxCall::new("AXUIElementSetAttributeValue", attribute, 0),
                Err(error) => error,
            },
            || match app.string_result("AXRole") {
                Ok(_) => AxCall::new("AXUIElementCopyAttributeValue", "AXRole", 0),
                Err(error) => error,
            },
        );
        let outcome = result.outcome;
        *self.enable_result.borrow_mut() = Some((pid, result));
        outcome
    }
}

impl Capturer {
    pub fn new() -> Self {
        Self {
            manual_accessibility: ManualAccessibility::default(),
            enable_results: HashMap::new(),
        }
    }

    pub fn selection(&mut self, deadline: Instant, skip: impl Fn(&AppInfo) -> bool) -> Result<Capture, CaptureError> {
        let host = MacAx::default();
        let target = accessible::resolve_target(&host, &mut self.manual_accessibility);
        let mut diagnostics = AxCaptureDiagnostics {
            focused_application: host.focused_failure.into_inner(),
            ..Default::default()
        };
        if let Some((pid, result)) = host.enable_result.into_inner() {
            diagnostics.enable_attempted = true;
            self.enable_results.insert(pid, result);
        }
        let target = target
            .ok_or_else(|| ax_capture_error(CaptureError::NoFocusedElement { app: None }, diagnostics.clone()))?;
        let pid = target.pid;
        if let Some(enable) = self.enable_results.get(&pid) {
            diagnostics.enable_accessibility = enable.calls.last().cloned();
            diagnostics.enable_calls = enable.calls.clone();
            diagnostics.enable_role = enable.role.clone();
            diagnostics.initializing = enable.initializing(Instant::now());
        }
        if pid as u32 == std::process::id() {
            return Err(CaptureError::OwnApp);
        }
        let app_el = Element::application(pid);
        app_el.set_timeout(AX_TIMEOUT_SECS);
        let app = app_info(pid, &app_el);
        if skip(&app) {
            return Err(CaptureError::Excluded { app });
        }

        // Chromium can take two seconds to finish enabling. Keep retries bounded by the
        // original capture deadline, including later gestures within that initialization window.
        let mut attempts = 0;
        loop {
            let failure = match read_selection(&app_el) {
                Ok(found) => {
                    return Ok(Capture { app, ..found });
                }
                Err(failure) => failure,
            };
            attempts += 1;
            if !(attempts < 2 || target.just_enabled || diagnostics.initializing)
                || Instant::now() + RETRY_DELAY > deadline
            {
                diagnostics.attempts = attempts;
                diagnostics.selection_failure = Some(failure);
                let focused = app_el.element_result("AXFocusedUIElement");
                let error = if let Err(error) = focused {
                    diagnostics.focused_element_failure = Some(error);
                    CaptureError::NoFocusedElement { app: Some(app) }
                } else {
                    CaptureError::NoText { app }
                };
                return Err(ax_capture_error(error, diagnostics));
            }
            thread::sleep(RETRY_DELAY);
        }
    }

    /// Clipboard fallback (see `clipboard`): the frontmost app's selection via Cmd+C.
    pub fn copy_selection(&mut self) -> Option<String> {
        clipboard::copy_selection(
            &pasteboard::General::new(),
            clipboard::COPY_TIMEOUT,
            clipboard::LATE_WRITE_GRACE,
            clipboard::POLL_INTERVAL,
        )
    }

    pub fn environment(&mut self, app: &AppInfo) -> Environment {
        let app_el = Element::application(app.pid as i32);
        app_el.set_timeout(AX_TIMEOUT_SECS);
        let window = app_el.element("AXFocusedWindow");
        let url = if env::is_browser(app.id.as_deref()) {
            find_url(&app_el, window.as_ref(), env::is_firefox(app.id.as_deref()))
        } else {
            None
        };
        Environment {
            app_name: app.name.clone(),
            window_title: window.as_ref().and_then(|w| w.string("AXTitle")),
            url,
            document_name: window.as_ref().and_then(|w| w.string("AXDocument")),
        }
    }
}

fn app_info(pid: i32, app_el: &Element) -> AppInfo {
    let running = NSRunningApplication::runningApplicationWithProcessIdentifier(pid);
    let name = running
        .as_ref()
        .and_then(|r| r.localizedName())
        .map(|s| s.to_string())
        .or_else(|| app_el.string("AXTitle"));
    let id = running
        .as_ref()
        .and_then(|r| r.bundleIdentifier())
        .map(|s| s.to_string());
    AppInfo {
        name,
        id,
        pid: pid as u32,
    }
}

fn ax_capture_error(error: CaptureError, mut diagnostics: AxCaptureDiagnostics) -> CaptureError {
    diagnostics.trusted = ax::is_trusted(false);
    CaptureError::WithAxDiagnostics {
        error: Box::new(error),
        diagnostics: Box::new(diagnostics),
    }
}

fn read_selection(app_el: &Element) -> Result<Capture, AxCall> {
    let focused = app_el.element_result("AXFocusedUIElement")?;
    read_focused_selection(&focused).or_else(|failure| web_selection(&focused).ok_or(failure))
}

fn read_focused_selection(focused: &Element) -> Result<Capture, AxCall> {
    let text = focused.string_result("AXSelectedText")?;
    if text.trim().is_empty() {
        return Err(
            AxCall::new("AXUIElementCopyAttributeValue", "AXSelectedText", 0).with_value_issue("empty-selection")
        );
    }
    let range = focused.range("AXSelectedTextRange").filter(|r| r.length > 0);
    let bounds = range.and_then(|r| focused.bounds_for_range(r)).map(|r| Rect {
        x: r.origin.x,
        y: r.origin.y,
        width: r.size.width,
        height: r.size.height,
    });
    let (context_before, context_after) = match range {
        Some(r) => read_context(focused, r),
        None => (None, None),
    };
    Ok(Capture {
        text,
        context_before,
        context_after,
        bounds,
        app: AppInfo::default(),
        method: "ax",
    })
}

/// Chromium pages that make rows or cells focusable (GitHub's diff view) focus a node that has
/// no `AXSelectedText`, while the selection belongs to the page. Read it from the enclosing web
/// area through text markers instead. No range, so no bounds or context.
fn web_selection(focused: &Element) -> Option<Capture> {
    let mut el = focused.clone();
    for _ in 0..40 {
        if el.string("AXRole").as_deref() == Some("AXWebArea") {
            let text = el.selected_text_marker_string().filter(|t| !t.trim().is_empty())?;
            return Some(Capture {
                text,
                context_before: None,
                context_after: None,
                bounds: None,
                app: AppInfo::default(),
                method: "ax-web",
            });
        }
        el = el.element("AXParent")?;
    }
    None
}

fn read_context(el: &Element, selection: CFRange) -> (Option<String>, Option<String>) {
    let n = CONTEXT_CHARS as isize;
    let before_start = (selection.location - n).max(0);
    let before = el.string_for_range(CFRange {
        location: before_start,
        length: selection.location - before_start,
    });
    let after_start = selection.location + selection.length;
    let after_len = match el.number("AXNumberOfCharacters") {
        Some(total) => (total as isize - after_start).clamp(0, n),
        None => n,
    };
    let after = el.string_for_range(CFRange {
        location: after_start,
        length: after_len,
    });
    let non_empty = |s: Option<String>| s.filter(|s| !s.trim().is_empty());
    (non_empty(before), non_empty(after))
}

/// Reads the page URL from the browser's web area (ADR 0004). Firefox may only expose it
/// through the address bar, which is used as a fallback.
fn find_url(app_el: &Element, window: Option<&Element>, firefox: bool) -> Option<String> {
    if let Some(mut el) = app_el.element("AXFocusedUIElement") {
        for _ in 0..40 {
            if el.string("AXRole").as_deref() == Some("AXWebArea") {
                if let Some(url) = el.url("AXURL") {
                    return Some(url);
                }
            }
            match el.element("AXParent") {
                Some(parent) => el = parent,
                None => break,
            }
        }
    }

    let mut queue = VecDeque::from([(window?.clone(), 0u32)]);
    let mut visited = 0;
    let mut address_bar = None;
    while let Some((el, depth)) = queue.pop_front() {
        visited += 1;
        if visited > 600 {
            break;
        }
        let role = el.string("AXRole").unwrap_or_default();
        if role == "AXWebArea" {
            if let Some(url) = el.url("AXURL") {
                return Some(url);
            }
            continue;
        }
        if firefox && address_bar.is_none() && (role == "AXTextField" || role == "AXComboBox") {
            address_bar = el.string("AXValue").filter(|v| v.contains('.') && !v.contains(' '));
        }
        if depth < 14 {
            queue.extend(el.children().into_iter().map(|c| (c, depth + 1)));
        }
    }
    address_bar
}

/// Cocoa screen coordinates have a bottom-left origin on the primary screen; everything else in
/// the prototype (CGEvent, AX) uses a top-left origin.
fn primary_height(mtm: MainThreadMarker) -> f64 {
    NSScreen::screens(mtm)
        .firstObject()
        .map(|s| s.frame().size.height)
        .unwrap_or(0.0)
}

fn to_top_left(r: NSRect, primary_height: f64) -> Rect {
    Rect {
        x: r.origin.x,
        y: primary_height - r.origin.y - r.size.height,
        width: r.size.width,
        height: r.size.height,
    }
}

pub fn display_at(app: &AppHandle, p: Point) -> Option<Display> {
    on_main(app, move |_| {
        let mtm = MainThreadMarker::new()?;
        let ph = primary_height(mtm);
        let screens = NSScreen::screens(mtm);
        let screen = screens
            .iter()
            .find(|s| to_top_left(s.frame(), ph).contains(p))
            .or_else(|| screens.firstObject())?;
        let work = to_top_left(screen.visibleFrame(), ph);
        Some(Display {
            origin: Point { x: work.x, y: work.y },
            width: work.width,
            height: work.height,
            scale: 1.0,
        })
    })
    .flatten()
}

/// Run AppKit work inside `@try/@catch`. An NSException that crosses into Rust aborts with
/// "Rust cannot catch foreign exceptions"; we log and keep going instead.
fn catch_objc<T>(what: &str, op: impl FnOnce() -> T) -> Option<T> {
    match objc2::exception::catch(std::panic::AssertUnwindSafe(op)) {
        Ok(v) => Some(v),
        Err(Some(e)) => {
            eprintln!("[pointer] objc exception in {what}: {e}");
            None
        }
        Err(None) => {
            eprintln!("[pointer] objc exception in {what} (unknown)");
            None
        }
    }
}

/// Create / configure overlay-style windows without activating the app. Creating a normal
/// `NSWindow` under `ActivationPolicy::Accessory` activates Pointer and raises every ordinary
/// window (settings). Same trick as tauri-nspanel's `no_activate`: briefly use Prohibited.
/// Must run on the main thread.
pub fn with_no_activate<T>(f: impl FnOnce() -> T) -> T {
    let original = MainThreadMarker::new().map(|mtm| {
        let app = NSApplication::sharedApplication(mtm);
        let policy = app.activationPolicy();
        let _ = app.setActivationPolicy(NSApplicationActivationPolicy::Prohibited);
        policy
    });
    let result = f();
    if let Some(policy) = original {
        if let Some(mtm) = MainThreadMarker::new() {
            let app = NSApplication::sharedApplication(mtm);
            let _ = app.setActivationPolicy(policy);
        }
    }
    result
}

fn apply_panel_chrome(panel: &dyn tauri_nspanel::Panel) {
    let _ = catch_objc("set_level", || panel.set_level(PanelLevel::Status.value()));
    if let Err(e) = panel.set_style_mask(StyleMask::empty().borderless().nonactivating_panel().value()) {
        eprintln!("[pointer] set_style_mask: {e:?}");
    }
    let _ = catch_objc("set_collection_behavior", || {
        panel.set_collection_behavior(
            CollectionBehavior::new()
                .can_join_all_spaces()
                .stationary()
                .full_screen_auxiliary()
                .ignores_cycle()
                .value(),
        );
    });
    let _ = catch_objc("set_hides_on_deactivate", || panel.set_hides_on_deactivate(false));
    let _ = catch_objc("set_has_shadow", || panel.set_has_shadow(false));
    // AppKit fades/zooms a window in when it is ordered front; the page does its own motion, and a
    // pinned panel appearing over the panel it replaces must not animate at all.
    let _ = catch_objc("set_animation_behavior", || {
        panel.as_panel().setAnimationBehavior(NSWindowAnimationBehavior::None)
    });
}

pub fn setup_overlay(_app: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    setup_overlay_with_frame(_app, window, None)
}

/// Convert to a non-activating panel, optionally place it, and accept mouse events.
pub fn setup_overlay_with_frame(_app: &AppHandle, window: &WebviewWindow, frame: Option<Rect>) -> tauri::Result<()> {
    // Always OverlayKeyPanel: canBecomeKeyWindow is fixed per class, and swapping
    // OverlayPanel↔OverlayKeyPanel on follow-up engage drops the Cocoa frame for a frame
    // (upward jump). becomesKeyOnlyIfNeeded keeps clicks from stealing key until engage /
    // a field editor actually needs it (ADR 0002).
    let panel = match catch_objc("to_panel", || window.to_panel::<OverlayKeyPanel>()) {
        Some(Ok(p)) => p,
        Some(Err(e)) => return Err(e),
        None => {
            return Err(tauri::Error::Io(std::io::Error::other(
                "objc exception while converting overlay to NSPanel",
            )))
        }
    };
    apply_panel_chrome(panel.as_ref());
    let _ = catch_objc("set_becomes_key_only_if_needed", || {
        panel.set_becomes_key_only_if_needed(true)
    });
    if let Some(frame) = frame {
        set_frame_on_panel(panel.as_ref(), frame);
    }
    // New windows must not start click-through; pin show/track_pins refine this later.
    let _ = catch_objc("setIgnoresMouseEvents", || panel.set_ignores_mouse_events(false));
    Ok(())
}

pub fn set_ignore_cursor(app: &AppHandle, ignore: bool) {
    set_ignore_cursor_of(app, OVERLAY, ignore);
}

pub fn set_ignore_cursor_of(app: &AppHandle, label: &str, ignore: bool) {
    let apply = |app: &AppHandle, label: &str, ignore: bool| {
        if let Ok(panel) = app.get_webview_panel(label) {
            let _ = catch_objc("setIgnoresMouseEvents", || panel.set_ignores_mouse_events(ignore));
        } else if let Some(w) = app.get_webview_window(label) {
            let _ = w.set_ignore_cursor_events(ignore);
        }
    };
    if MainThreadMarker::new().is_some() {
        apply(app, label, ignore);
        return;
    }
    // Mouse-tap thread: queue onto the main run loop (do not wait — that would stall input).
    let app = app.clone();
    let label = label.to_string();
    let _ = app.clone().run_on_main_thread(move || apply(&app, &label, ignore));
}

fn cocoa_rect(frame: Rect, mtm: MainThreadMarker) -> NSRect {
    let ph = primary_height(mtm);
    NSRect::new(
        NSPoint::new(frame.x, ph - frame.y - frame.height),
        NSSize::new(frame.width, frame.height),
    )
}

fn set_frame_on_panel(panel: &dyn tauri_nspanel::Panel, frame: Rect) {
    let Some(mtm) = MainThreadMarker::new() else {
        eprintln!("[pointer] set_frame: not on main thread");
        return;
    };
    let rect = cocoa_rect(frame, mtm);
    let _ = catch_objc("setFrame_display", || panel.as_panel().setFrame_display(rect, true));
}

pub fn set_frame(app: &AppHandle, frame: Rect) {
    set_frame_of(app, OVERLAY, frame);
}

pub fn set_frame_of(app: &AppHandle, label: &str, frame: Rect) {
    match app.get_webview_panel(label) {
        Ok(panel) => set_frame_on_panel(panel.as_ref(), frame),
        Err(_) => eprintln!("[pointer] set_frame_of({label}): panel not found"),
    }
}

pub fn show(app: &AppHandle) {
    show_of(app, OVERLAY);
}

pub fn show_of(app: &AppHandle, label: &str) {
    if let Ok(panel) = app.get_webview_panel(label) {
        let _ = catch_objc("panel.show", || panel.show());
    }
}

/// Keep the webview eligible to paint without visibly compositing a second translucent card.
pub fn prepare_pin(app: &AppHandle, label: &str) {
    if let Ok(panel) = app.get_webview_panel(label) {
        let _ = catch_objc("prepare pin alpha", || panel.set_alpha_value(0.001));
    }
}

/// The two native windows change visibility in one WindowServer update, not two JS paints.
#[allow(deprecated)]
pub fn reveal_pin(app: &AppHandle, label: &str, replace_overlay: bool) {
    let Ok(panel) = app.get_webview_panel(label) else {
        return;
    };
    // Keep the guard outside Objective-C's catch so updates resume even if AppKit throws.
    struct ScreenUpdates;
    impl Drop for ScreenUpdates {
        fn drop(&mut self) {
            objc2_app_kit::NSEnableScreenUpdates();
        }
    }
    // Only the synchronous visibility swap is protected; never hold updates across IPC/rAF.
    objc2_app_kit::NSDisableScreenUpdates();
    let _updates = ScreenUpdates;
    let _ = catch_objc("reveal pin", || {
        panel.set_alpha_value(1.0);
        if replace_overlay {
            if let Ok(overlay) = app.get_webview_panel(OVERLAY) {
                overlay.hide();
            }
        }
    });
}

pub fn hide(app: &AppHandle) {
    hide_of(app, OVERLAY);
}

pub fn hide_of(app: &AppHandle, label: &str) {
    if let Ok(panel) = app.get_webview_panel(label) {
        let _ = catch_objc("panel.hide", || panel.hide());
    }
}

/// Restore the native NSWindow class and drop the panel handle. Needed before destroy, and before
/// swapping OverlayPanel ↔ OverlayKeyPanel (nested `to_panel` corrupts `original_class`).
pub fn teardown_panel(app: &AppHandle, label: &str) {
    if let Ok(panel) = app.get_webview_panel(label) {
        let _ = catch_objc("panel.hide", || panel.hide());
        let _ = catch_objc("panel.to_window", || panel.to_window());
    }
}

/// ADR 0002: the panel becomes the key window without activating the app, so the host app stays
/// frontmost and keeps its menu bar.
pub fn set_keyboard_focus(app: &AppHandle, on: bool) {
    set_keyboard_focus_of(app, OVERLAY, on);
}

/// Make the overlay (or a pinned panel) key for a follow-up input without `makeFirstResponder`.
/// JS focuses the textarea with `preventScroll`. No OverlayPanel↔KeyPanel class swap (that drops
/// the Cocoa frame). `makeFirstResponder` is also skipped — WKWebView would scroll to the caret.
pub fn prepare_keyboard_focus(app: &AppHandle) {
    prepare_keyboard_focus_of(app, OVERLAY);
}

pub fn prepare_keyboard_focus_of(app: &AppHandle, label: &str) {
    set_keyboard_focus_of_ex(app, label, true, false);
}

fn make_webview_first_responder(window: &WebviewWindow) {
    let _ = catch_objc("makeFirstResponder", || {
        let _ = window.with_webview(|webview| {
            let ns_window = webview.ns_window() as *mut AnyObject;
            let view = webview.inner() as *mut AnyObject;
            if !ns_window.is_null() && !view.is_null() {
                let _: bool = unsafe { msg_send![ns_window, makeFirstResponder: view] };
            }
        });
    });
}

pub fn set_keyboard_focus_of(app: &AppHandle, label: &str, on: bool) {
    // Lightbox / Esc paths still need the webview as first responder when there is no focused input.
    set_keyboard_focus_of_ex(app, label, on, true);
}

fn set_keyboard_focus_of_ex(app: &AppHandle, label: &str, on: bool, make_first_responder: bool) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    // Overlays are born as OverlayKeyPanel (see setup_overlay_with_frame). Never to_window/to_panel
    // on engage: that class swap drops the Cocoa frame for a paint and the panel jumps upward.
    if let Ok(panel) = app.get_webview_panel(label) {
        if on {
            // Allow key even when clicking non-editable chrome (header drag, buttons).
            let _ = catch_objc("set_becomes_key_only_if_needed", || {
                panel.set_becomes_key_only_if_needed(false)
            });
            // Re-assert frame around makeKey — AppKit can nudge a panel when it becomes key.
            let saved = catch_objc("panel.frame", || panel.as_panel().frame());
            let _ = catch_objc("make_key_window", || panel.make_key_window());
            if let Some(rect) = saved {
                let _ = catch_objc("setFrame_display", || panel.as_panel().setFrame_display(rect, true));
            }
            if make_first_responder {
                make_webview_first_responder(&window);
            }
        } else {
            let _ = catch_objc("resign_key_window", || panel.resign_key_window());
            let _ = catch_objc("set_becomes_key_only_if_needed", || {
                panel.set_becomes_key_only_if_needed(true)
            });
        }
        return;
    }
    // Panel handle missing (should not happen after setup) — one-shot convert, still KeyPanel only.
    let panel = match catch_objc("to_panel", || window.to_panel::<OverlayKeyPanel>()) {
        Some(Ok(p)) => p,
        Some(Err(e)) => {
            eprintln!("[pointer] overlay panel class: {e}");
            return;
        }
        None => return,
    };
    apply_panel_chrome(panel.as_ref());
    let _ = catch_objc("set_becomes_key_only_if_needed", || {
        panel.set_becomes_key_only_if_needed(!on)
    });
    if on {
        let _ = catch_objc("make_key_window", || panel.make_key_window());
        if make_first_responder {
            make_webview_first_responder(&window);
        }
    }
}
