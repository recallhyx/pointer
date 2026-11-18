//! [`Pasteboard`] on the general NSPasteboard, with Cmd+C posted as a CGEvent.

use std::ffi::c_void;

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardTypeString, NSPasteboardWriting};
use objc2_foundation::{NSArray, NSData, NSString};

use crate::platform::clipboard::Pasteboard;

type CGEventRef = *mut c_void;

const KEY_C: u16 = 8;
const FLAG_COMMAND: u64 = 0x0010_0000;
const HID_EVENT_TAP: u32 = 0;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventCreateKeyboardEvent(source: *const c_void, key: u16, down: bool) -> CGEventRef;
    fn CGEventSetFlags(event: CGEventRef, flags: u64);
    fn CGEventPost(tap: u32, event: CGEventRef);
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
}

pub struct General(Retained<NSPasteboard>);

impl General {
    pub fn new() -> Self {
        General(NSPasteboard::generalPasteboard())
    }
}

/// Every item as (type, data) pairs.
pub type Snapshot = Vec<Vec<(Retained<NSString>, Retained<NSData>)>>;

impl Pasteboard for General {
    type Snapshot = Snapshot;

    fn change_count(&self) -> i64 {
        self.0.changeCount() as i64
    }

    fn snapshot(&self) -> Snapshot {
        let Some(items) = self.0.pasteboardItems() else {
            return Vec::new();
        };
        items
            .iter()
            .map(|item| {
                item.types()
                    .iter()
                    .filter_map(|ty| item.dataForType(&ty).map(|data| (ty.clone(), data)))
                    .collect()
            })
            .collect()
    }

    fn restore(&self, snapshot: Snapshot) {
        self.0.clearContents();
        if snapshot.is_empty() {
            return;
        }
        let items: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> = snapshot
            .into_iter()
            .map(|pairs| {
                let item = NSPasteboardItem::new();
                for (ty, data) in pairs {
                    item.setData_forType(&data, &ty);
                }
                ProtocolObject::from_retained(item)
            })
            .collect();
        self.0.writeObjects(&NSArray::from_retained_slice(&items));
    }

    fn read_text(&self) -> Option<String> {
        self.0
            .stringForType(unsafe { NSPasteboardTypeString })
            .map(|s| s.to_string())
    }

    fn send_copy(&self) -> bool {
        for down in [true, false] {
            let event = unsafe { CGEventCreateKeyboardEvent(std::ptr::null(), KEY_C, down) };
            if event.is_null() {
                return false;
            }
            unsafe {
                // Explicit flags: modifiers still held for the trigger shortcut must not turn
                // this into another command (Cmd+Opt+C opens devtools in Chrome).
                CGEventSetFlags(event, FLAG_COMMAND);
                CGEventPost(HID_EVENT_TAP, event);
                CFRelease(event);
            }
        }
        true
    }
}
