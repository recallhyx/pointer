mod hook;
mod pasteboard;

use std::ffi::c_void;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::mpsc::Sender;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, WebviewWindow};
use windows::core::Interface;
use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, SAFEARRAY,
};
use windows::Win32::System::Ole::{
    SafeArrayAccessData, SafeArrayDestroy, SafeArrayGetLBound, SafeArrayGetUBound, SafeArrayUnaccessData,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Accessibility::{
    AccessibleObjectFromWindow, CUIAutomation, IAccessible, IUIAutomation, IUIAutomationTextPattern,
    IUIAutomationTextRange, IUIAutomationValuePattern, TextPatternRangeEndpoint_End, TextPatternRangeEndpoint_Start,
    TextUnit_Character, TreeScope_Descendants, UIA_ControlTypePropertyId, UIA_DocumentControlTypeId, UIA_TextPatternId,
    UIA_ValuePatternId,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetCursorPos, GetForegroundWindow, GetGUIThreadInfo, GetWindowLongPtrW, GetWindowTextW,
    GetWindowThreadProcessId, IsWindow, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos, ShowWindow,
    GUITHREADINFO, GWL_EXSTYLE, HWND_TOPMOST, OBJID_CLIENT, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    SW_HIDE, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
};

use super::accessible::{self, AxHost, EnableOutcome, ManualAccessibility};
use super::clipboard;
use super::{Capture, CaptureError, MouseEvent, CONTEXT_CHARS};
use crate::controller::OVERLAY;
use crate::env::{self, AppInfo, Environment};
use crate::geometry::{Display, Point, Rect};

pub const POINTER_EVENTS: bool = true;

const RETRY_DELAY: Duration = Duration::from_millis(40);

pub fn ensure_permissions() -> bool {
    true
}

/// Windows has no accessibility permission prompt; UI Automation just works.
pub fn accessibility_allowed() -> bool {
    true
}

pub fn open_accessibility_settings() {}

pub fn start_mouse_listener(tx: Sender<MouseEvent>) {
    hook::start(tx);
}

pub fn cursor_position(_app: &AppHandle) -> Option<Point> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p) }.ok()?;
    Some(Point {
        x: p.x as f64,
        y: p.y as f64,
    })
}

pub struct Capturer {
    uia: Option<IUIAutomation>,
    /// Apps we already asked to build their accessibility tree (see `accessible`).
    enabled: ManualAccessibility,
}

/// The foreground window is always known on Windows, so the focused and frontmost app are the
/// same; what matters here is waking Chromium's accessibility up.
struct WinAx;

impl AxHost for WinAx {
    fn focused_app_pid(&self) -> Option<i32> {
        let fg = unsafe { GetForegroundWindow() };
        (!fg.is_invalid()).then(|| host_window(fg).1 as i32)
    }

    fn frontmost_pid(&self) -> Option<i32> {
        self.focused_app_pid()
    }

    /// Chromium and Electron enable their web accessibility tree when a client requests the
    /// accessible object of their window (`WM_GETOBJECT` / `OBJID_CLIENT`). UIA usually does
    /// that on its own; asking explicitly makes the first capture in a new app reliable.
    fn enable_accessibility(&self, pid: i32) -> EnableOutcome {
        let Some(hwnd) = focus_window() else {
            return EnableOutcome::Retry;
        };
        if window_pid(hwnd) as i32 != pid {
            return EnableOutcome::Retry;
        }
        let mut object: *mut c_void = std::ptr::null_mut();
        if unsafe { AccessibleObjectFromWindow(hwnd, OBJID_CLIENT.0 as u32, &IAccessible::IID, &mut object) }.is_ok()
            && !object.is_null()
        {
            drop(unsafe { IAccessible::from_raw(object) });
            EnableOutcome::Accepted
        } else {
            EnableOutcome::Retry
        }
    }
}

/// The window with keyboard focus in the foreground thread (Chromium's render widget, not the
/// top-level frame), falling back to the foreground window.
fn focus_window() -> Option<HWND> {
    let fg = unsafe { GetForegroundWindow() };
    if fg.is_invalid() {
        return None;
    }
    let thread = unsafe { GetWindowThreadProcessId(fg, None) };
    let mut info = GUITHREADINFO {
        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };
    match unsafe { GetGUIThreadInfo(thread, &mut info) } {
        Ok(()) if !info.hwndFocus.is_invalid() => Some(info.hwndFocus),
        _ => Some(fg),
    }
}

impl Capturer {
    pub fn new() -> Self {
        let uia = unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()
        };
        Self {
            uia,
            enabled: ManualAccessibility::default(),
        }
    }

    pub fn selection(&mut self, deadline: Instant, skip: impl Fn(&AppInfo) -> bool) -> Result<Capture, CaptureError> {
        let uia = self.uia.as_ref().ok_or(CaptureError::Unsupported)?;
        let target = accessible::resolve_target(&WinAx, &mut self.enabled)
            .ok_or(CaptureError::NoFocusedElement { app: None })?;
        let pid = target.pid as u32;
        if pid == std::process::id() {
            return Err(CaptureError::OwnApp);
        }
        let app = app_info(pid);
        if skip(&app) {
            return Err(CaptureError::Excluded { app });
        }
        // The first read after waking an app's tree up is often empty, so retry until the deadline
        // then; otherwise retry once, because some apps update the selection after mouse-up.
        let mut attempts = 0;
        loop {
            if let Some(found) = read_selection(uia) {
                return Ok(Capture { app, ..found });
            }
            attempts += 1;
            if !(attempts < 2 || target.just_enabled) || Instant::now() + RETRY_DELAY > deadline {
                return Err(if unsafe { uia.GetFocusedElement() }.is_err() {
                    CaptureError::NoFocusedElement { app: Some(app) }
                } else {
                    CaptureError::NoText { app }
                });
            }
            thread::sleep(RETRY_DELAY);
        }
    }

    /// Clipboard fallback (see `clipboard`): the foreground app's selection via Ctrl+C.
    pub fn copy_selection(&mut self) -> Option<String> {
        clipboard::copy_selection(
            &pasteboard::Clipboard,
            clipboard::COPY_TIMEOUT,
            clipboard::LATE_WRITE_GRACE,
            clipboard::POLL_INTERVAL,
        )
    }

    pub fn environment(&mut self, app: &AppInfo) -> Environment {
        let (hwnd, pid) = host_window(unsafe { GetForegroundWindow() });
        if pid != app.pid {
            return Environment {
                app_name: app.name.clone(),
                ..Default::default()
            };
        }
        let url = match (&self.uia, env::is_browser(app.id.as_deref())) {
            (Some(uia), true) => browser_url(uia, hwnd),
            _ => None,
        };
        Environment {
            app_name: app.name.clone(),
            window_title: window_text(hwnd),
            url,
            document_name: None,
        }
    }
}

fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

/// UWP / Store apps are hosted by ApplicationFrameHost.exe; the real app owns a child window.
fn host_window(fg: HWND) -> (HWND, u32) {
    let pid = window_pid(fg);
    if !exe_path(pid).is_some_and(|p| p.to_ascii_lowercase().ends_with("applicationframehost.exe")) {
        return (fg, pid);
    }
    struct Search {
        host_pid: u32,
        found: Option<(HWND, u32)>,
    }
    unsafe extern "system" fn visit(child: HWND, lparam: LPARAM) -> BOOL {
        let search = &mut *(lparam.0 as *mut Search);
        let pid = window_pid(child);
        if pid != search.host_pid {
            search.found = Some((child, pid));
            return BOOL(0);
        }
        BOOL(1)
    }
    let mut search = Search {
        host_pid: pid,
        found: None,
    };
    unsafe {
        let _ = EnumChildWindows(Some(fg), Some(visit), LPARAM(&mut search as *mut Search as isize));
    }
    match search.found {
        Some((_, child_pid)) => (fg, child_pid),
        None => (fg, pid),
    }
}

fn exe_path(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(handle);
        ok.ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

fn window_text(hwnd: HWND) -> Option<String> {
    let mut buf = [0u16; 512];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    (len > 0).then(|| String::from_utf16_lossy(&buf[..len as usize]))
}

fn app_info(pid: u32) -> AppInfo {
    let exe = exe_path(pid).and_then(|p| p.rsplit(['\\', '/']).next().map(str::to_string));
    let name = exe.as_deref().map(|e| {
        let known = match e.to_ascii_lowercase().as_str() {
            "chrome.exe" => Some("Google Chrome"),
            "msedge.exe" => Some("Microsoft Edge"),
            "firefox.exe" => Some("Firefox"),
            "code.exe" => Some("Visual Studio Code"),
            "cursor.exe" => Some("Cursor"),
            "winword.exe" => Some("Microsoft Word"),
            "wechat.exe" | "weixin.exe" => Some("微信"),
            "feishu.exe" | "lark.exe" => Some("飞书"),
            "notion.exe" => Some("Notion"),
            "obsidian.exe" => Some("Obsidian"),
            "acrord32.exe" | "acrobat.exe" => Some("Adobe Acrobat"),
            _ => None,
        };
        known
            .map(str::to_string)
            .unwrap_or_else(|| e.trim_end_matches(".exe").trim_end_matches(".EXE").to_string())
    });
    AppInfo { name, id: exe, pid }
}

fn read_selection(uia: &IUIAutomation) -> Option<Capture> {
    unsafe {
        let mut el = uia.GetFocusedElement().ok()?;
        let walker = uia.ControlViewWalker().ok()?;
        let mut pattern = None;
        for _ in 0..8 {
            if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) {
                pattern = Some(p);
                break;
            }
            match walker.GetParentElement(&el) {
                Ok(parent) => el = parent,
                Err(_) => break,
            }
        }
        let ranges = pattern?.GetSelection().ok()?;
        if ranges.Length().ok()? < 1 {
            return None;
        }
        let range = ranges.GetElement(0).ok()?;
        let text = range.GetText(-1).ok()?.to_string();
        if text.trim().is_empty() {
            return None;
        }
        let bounds = range.GetBoundingRectangles().ok().and_then(|sa| union_of_rects(sa));
        let (context_before, context_after) = read_context(&range);
        Some(Capture {
            text,
            context_before,
            context_after,
            bounds,
            app: AppInfo::default(),
            method: "uia",
        })
    }
}

unsafe fn read_context(range: &IUIAutomationTextRange) -> (Option<String>, Option<String>) {
    let n = CONTEXT_CHARS as i32;
    let before = range.Clone().ok().and_then(|r| {
        r.MoveEndpointByRange(TextPatternRangeEndpoint_End, range, TextPatternRangeEndpoint_Start)
            .ok()?;
        r.MoveEndpointByUnit(TextPatternRangeEndpoint_Start, TextUnit_Character, -n)
            .ok()?;
        r.GetText(n).ok()
    });
    let after = range.Clone().ok().and_then(|r| {
        r.MoveEndpointByRange(TextPatternRangeEndpoint_Start, range, TextPatternRangeEndpoint_End)
            .ok()?;
        r.MoveEndpointByUnit(TextPatternRangeEndpoint_End, TextUnit_Character, n)
            .ok()?;
        r.GetText(n).ok()
    });
    let clean = |s: Option<windows::core::BSTR>| s.map(|b| b.to_string()).filter(|s| !s.trim().is_empty());
    (clean(before), clean(after))
}

/// `GetBoundingRectangles` returns one (left, top, width, height) quad per line.
unsafe fn union_of_rects(sa: *mut SAFEARRAY) -> Option<Rect> {
    if sa.is_null() {
        return None;
    }
    let mut result = None;
    if let (Ok(lb), Ok(ub)) = (SafeArrayGetLBound(sa, 1), SafeArrayGetUBound(sa, 1)) {
        let mut data: *mut c_void = std::ptr::null_mut();
        if ub >= lb && SafeArrayAccessData(sa, &mut data).is_ok() {
            let values = std::slice::from_raw_parts(data as *const f64, (ub - lb + 1) as usize);
            for q in values.as_chunks::<4>().0 {
                if q[2] <= 0.0 || q[3] <= 0.0 {
                    continue;
                }
                let r = Rect {
                    x: q[0],
                    y: q[1],
                    width: q[2],
                    height: q[3],
                };
                result = Some(match result {
                    None => r,
                    Some(acc) => union(acc, r),
                });
            }
            let _ = SafeArrayUnaccessData(sa);
        }
    }
    let _ = SafeArrayDestroy(sa);
    result
}

fn union(a: Rect, b: Rect) -> Rect {
    let x = a.x.min(b.x);
    let y = a.y.min(b.y);
    Rect {
        x,
        y,
        width: (a.x + a.width).max(b.x + b.width) - x,
        height: (a.y + a.height).max(b.y + b.height) - y,
    }
}

/// Chrome, Edge and Firefox expose the page URL as the value of the Document control (ADR 0004).
fn browser_url(uia: &IUIAutomation, hwnd: HWND) -> Option<String> {
    unsafe {
        let root = uia.ElementFromHandle(hwnd).ok()?;
        let condition = uia
            .CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(UIA_DocumentControlTypeId.0))
            .ok()?;
        let doc = root.FindFirst(TreeScope_Descendants, &condition).ok()?;
        let value = doc
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            .ok()?;
        let url = value.CurrentValue().ok()?.to_string();
        (!url.is_empty()).then_some(url)
    }
}

pub fn display_at(_app: &AppHandle, p: Point) -> Option<Display> {
    unsafe {
        let monitor = MonitorFromPoint(
            POINT {
                x: p.x as i32,
                y: p.y as i32,
            },
            MONITOR_DEFAULTTONEAREST,
        );
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return None;
        }
        let (mut dpi_x, mut dpi_y) = (96u32, 96u32);
        let _ = GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y);
        let work = info.rcWork;
        Some(Display {
            origin: Point {
                x: work.left as f64,
                y: work.top as f64,
            },
            width: (work.right - work.left) as f64,
            height: (work.bottom - work.top) as f64,
            scale: dpi_x as f64 / 96.0,
        })
    }
}

pub fn with_no_activate<T>(f: impl FnOnce() -> T) -> T {
    f()
}

fn hwnd_of(app: &AppHandle, label: &str) -> Option<HWND> {
    app.get_webview_window(label)?.hwnd().ok()
}

/// tao rewrites the window style (and calls `ShowWindow(SW_SHOW)`, which activates) whenever one
/// of its own setters runs, so after setup the overlay is only touched through Win32 directly.
pub fn setup_overlay(app: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    setup_overlay_with_frame(app, window, None)
}

pub fn setup_overlay_with_frame(
    _app: &AppHandle,
    window: &WebviewWindow,
    frame: Option<crate::geometry::Rect>,
) -> tauri::Result<()> {
    let hwnd = window.hwnd()?;
    // Apply NOACTIVATE before any ShowWindow: tao's show activates, which would steal focus from
    // the host app when creating a pinned panel mid-use.
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let ex =
            (ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0 | WS_EX_TOPMOST.0) as isize) & !(WS_EX_APPWINDOW.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
    }
    // Show once through tao so the webview is marked visible, then hide it ourselves.
    window.show()?;
    unsafe {
        let _ = ShowWindow(hwnd, SW_HIDE);
        let disabled = BOOL(1);
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_TRANSITIONS_FORCEDISABLED,
            &disabled as *const _ as *const c_void,
            std::mem::size_of::<BOOL>() as u32,
        );
        let corner = DWMWCP_DONOTROUND;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &corner as *const _ as *const c_void,
            std::mem::size_of_val(&corner) as u32,
        );
        if let Some(frame) = frame {
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                frame.x.round() as i32,
                frame.y.round() as i32,
                frame.width.round() as i32,
                frame.height.round() as i32,
                SWP_NOACTIVATE,
            );
        }
    }
    Ok(())
}

pub fn set_ignore_cursor(app: &AppHandle, ignore: bool) {
    set_ignore_cursor_of(app, OVERLAY, ignore);
}

pub fn set_ignore_cursor_of(app: &AppHandle, label: &str, ignore: bool) {
    let Some(hwnd) = hwnd_of(app, label) else { return };
    let bits = (WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0) as isize;
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let next = if ignore { ex | bits } else { ex & !bits };
        if next != ex {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
        }
    }
}

pub fn set_frame(app: &AppHandle, frame: Rect) {
    set_frame_of(app, OVERLAY, frame);
}

pub fn set_frame_of(app: &AppHandle, label: &str, frame: Rect) {
    let Some(hwnd) = hwnd_of(app, label) else { return };
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            frame.x.round() as i32,
            frame.y.round() as i32,
            frame.width.round() as i32,
            frame.height.round() as i32,
            SWP_NOACTIVATE,
        );
    }
}

pub fn show(app: &AppHandle) {
    show_of(app, OVERLAY);
}

pub fn show_of(app: &AppHandle, label: &str) {
    let Some(hwnd) = hwnd_of(app, label) else { return };
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
    }
}

pub fn hide(app: &AppHandle) {
    hide_of(app, OVERLAY);
}

pub fn hide_of(app: &AppHandle, label: &str) {
    let Some(hwnd) = hwnd_of(app, label) else { return };
    unsafe {
        let _ = ShowWindow(hwnd, SW_HIDE);
    }
}

/// The window that was in the foreground when the overlay took keyboard focus.
static HOST_WINDOW: AtomicIsize = AtomicIsize::new(0);

/// ADR 0002: a window that never activates gets no keyboard input, so the overlay has to come to
/// the foreground; the host window gets it back when the overlay lets go. The user just clicked
/// the overlay, which is what allows `SetForegroundWindow` here. wry moves focus into WebView2 on
/// `WM_SETFOCUS`.
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
    let Some(hwnd) = hwnd_of(app, label) else { return };
    let no_activate = WS_EX_NOACTIVATE.0 as isize;
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if on {
            let fg = GetForegroundWindow();
            if !fg.is_invalid() && fg != hwnd {
                HOST_WINDOW.store(fg.0 as isize, Ordering::SeqCst);
            }
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex & !no_activate);
            let _ = SetForegroundWindow(hwnd);
        } else {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | no_activate);
            let host = HWND(HOST_WINDOW.swap(0, Ordering::SeqCst) as *mut c_void);
            if GetForegroundWindow() == hwnd && !host.is_invalid() && IsWindow(Some(host)).as_bool() {
                let _ = SetForegroundWindow(host);
            }
        }
    }
}
