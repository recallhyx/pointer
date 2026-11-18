//! Listen-only CGEventTap for mouse events. Keyboard events are deliberately not in the mask
//! (CONTEXT.md: 全局快捷键 — no global keyboard monitoring).

use std::ffi::c_void;
use std::sync::mpsc::Sender;
use std::thread;
use std::time::Duration;

use super::ax::CGPoint;
use crate::geometry::Point;
use crate::platform::MouseEvent;

type CFMachPortRef = *mut c_void;
type CFRunLoopSourceRef = *mut c_void;
type CFRunLoopRef = *mut c_void;
type CGEventRef = *mut c_void;
type CGEventTapProxy = *mut c_void;
type TapCallback = extern "C" fn(CGEventTapProxy, u32, CGEventRef, *mut c_void) -> CGEventRef;

const SESSION_EVENT_TAP: u32 = 1;
const HEAD_INSERT: u32 = 0;
const LISTEN_ONLY: u32 = 1;

const LEFT_DOWN: u32 = 1;
const LEFT_UP: u32 = 2;
const RIGHT_DOWN: u32 = 3;
const MOVED: u32 = 5;
const LEFT_DRAGGED: u32 = 6;
const SCROLL: u32 = 22;
const OTHER_DOWN: u32 = 25;
const TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;

const FIELD_CLICK_STATE: u32 = 1;
const FLAG_SHIFT: u64 = 0x0002_0000;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: TapCallback,
        user_info: *mut c_void,
    ) -> CFMachPortRef;
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
    fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
    fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    fn CGEventGetFlags(event: CGEventRef) -> u64;
    fn CGEventCreate(source: *const c_void) -> CGEventRef;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFRunLoopCommonModes: *const c_void;
    fn CFMachPortCreateRunLoopSource(allocator: *const c_void, port: CFMachPortRef, order: isize)
        -> CFRunLoopSourceRef;
    fn CFRunLoopGetCurrent() -> CFRunLoopRef;
    fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: *const c_void);
    fn CFRunLoopRun();
    fn CFRelease(cf: *const c_void);
}

struct TapContext {
    tx: Sender<MouseEvent>,
    port: CFMachPortRef,
}

extern "C" fn on_event(_proxy: CGEventTapProxy, ty: u32, event: CGEventRef, user: *mut c_void) -> CGEventRef {
    let ctx = unsafe { &*(user as *const TapContext) };
    if ty == TAP_DISABLED_BY_TIMEOUT || ty == TAP_DISABLED_BY_USER_INPUT {
        unsafe { CGEventTapEnable(ctx.port, true) };
        return event;
    }
    let loc = unsafe { CGEventGetLocation(event) };
    let at = Point { x: loc.x, y: loc.y };
    let ev = match ty {
        LEFT_DOWN => MouseEvent::LeftDown(at),
        LEFT_UP => MouseEvent::LeftUp {
            at,
            clicks: unsafe { CGEventGetIntegerValueField(event, FIELD_CLICK_STATE) }.max(0) as u32,
            shift: unsafe { CGEventGetFlags(event) } & FLAG_SHIFT != 0,
        },
        RIGHT_DOWN | OTHER_DOWN => MouseEvent::OtherDown(at),
        MOVED | LEFT_DRAGGED => MouseEvent::Move(at),
        SCROLL => MouseEvent::Wheel,
        _ => return event,
    };
    let _ = ctx.tx.send(ev);
    event
}

pub fn start(tx: Sender<MouseEvent>) {
    thread::Builder::new()
        .name("event-tap".into())
        .spawn(move || {
            let mask = [LEFT_DOWN, LEFT_UP, RIGHT_DOWN, MOVED, LEFT_DRAGGED, SCROLL, OTHER_DOWN]
                .iter()
                .fold(0u64, |m, t| m | (1u64 << t));
            let ctx = Box::into_raw(Box::new(TapContext {
                tx,
                port: std::ptr::null_mut(),
            }));
            // Creating the tap fails until Accessibility is granted; keep retrying so the user
            // does not have to restart after granting it.
            let port = loop {
                let port = unsafe {
                    CGEventTapCreate(
                        SESSION_EVENT_TAP,
                        HEAD_INSERT,
                        LISTEN_ONLY,
                        mask,
                        on_event,
                        ctx as *mut c_void,
                    )
                };
                if !port.is_null() {
                    break port;
                }
                thread::sleep(Duration::from_secs(2));
            };
            unsafe {
                (*ctx).port = port;
                let source = CFMachPortCreateRunLoopSource(std::ptr::null(), port, 0);
                CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
                CGEventTapEnable(port, true);
                CFRunLoopRun();
            }
        })
        .expect("spawn event tap thread");
}

pub fn cursor_position() -> Option<Point> {
    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            return None;
        }
        let loc = CGEventGetLocation(event);
        CFRelease(event);
        Some(Point { x: loc.x, y: loc.y })
    }
}
