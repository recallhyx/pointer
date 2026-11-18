//! WH_MOUSE_LL hook on a dedicated thread. The hook procedure must return quickly, so it only
//! forwards events; all decisions happen on the controller thread.

use std::cell::Cell;
use std::sync::mpsc::Sender;
use std::sync::OnceLock;
use std::thread;

use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, GetDoubleClickTime, VK_SHIFT};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, GetSystemMetrics, SetWindowsHookExW, MSG, MSLLHOOKSTRUCT, SM_CXDOUBLECLK,
    SM_CYDOUBLECLK, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MOUSEHWHEEL, WM_MOUSEMOVE,
    WM_MOUSEWHEEL, WM_RBUTTONDOWN, WM_XBUTTONDOWN,
};

use crate::geometry::Point;
use crate::platform::MouseEvent;

static TX: OnceLock<Sender<MouseEvent>> = OnceLock::new();

thread_local! {
    /// (time, x, y, count) of the last left button down, for counting multi-clicks.
    static LAST_DOWN: Cell<(u32, i32, i32, u32)> = const { Cell::new((0, 0, 0, 0)) };
}

fn click_count(time: u32, x: i32, y: i32) -> u32 {
    let (last_time, lx, ly, count) = LAST_DOWN.get();
    let (dx, dy) = unsafe {
        (
            GetSystemMetrics(SM_CXDOUBLECLK) / 2,
            GetSystemMetrics(SM_CYDOUBLECLK) / 2,
        )
    };
    let within =
        time.wrapping_sub(last_time) <= unsafe { GetDoubleClickTime() } && (x - lx).abs() <= dx && (y - ly).abs() <= dy;
    let count = if within && count > 0 { count + 1 } else { 1 };
    LAST_DOWN.set((time, x, y, count));
    count
}

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        let at = Point {
            x: info.pt.x as f64,
            y: info.pt.y as f64,
        };
        let ev = match wparam.0 as u32 {
            WM_LBUTTONDOWN => {
                click_count(info.time, info.pt.x, info.pt.y);
                Some(MouseEvent::LeftDown(at))
            }
            WM_LBUTTONUP => Some(MouseEvent::LeftUp {
                at,
                clicks: LAST_DOWN.get().3,
                shift: GetAsyncKeyState(VK_SHIFT.0 as i32) < 0,
            }),
            WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN => Some(MouseEvent::OtherDown(at)),
            WM_MOUSEMOVE => Some(MouseEvent::Move(at)),
            WM_MOUSEWHEEL | WM_MOUSEHWHEEL => Some(MouseEvent::Wheel),
            _ => None,
        };
        if let (Some(ev), Some(tx)) = (ev, TX.get()) {
            let _ = tx.send(ev);
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

pub fn start(tx: Sender<MouseEvent>) {
    let _ = TX.set(tx);
    thread::Builder::new()
        .name("mouse-hook".into())
        .spawn(|| unsafe {
            let module = GetModuleHandleW(None).ok().map(|m| HINSTANCE(m.0));
            if let Err(e) = SetWindowsHookExW(WH_MOUSE_LL, Some(hook_proc), module, 0) {
                eprintln!("[pointer] SetWindowsHookExW failed: {e}");
                return;
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
        })
        .expect("spawn mouse hook thread");
}
