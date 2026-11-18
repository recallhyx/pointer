//! [`Pasteboard`] on the Win32 clipboard, with Ctrl+C sent through `SendInput`.
//!
//! The snapshot keeps every format whose data is an `HGLOBAL` (text in all encodings, CF_DIB /
//! CF_DIBV5 images, CF_HDROP file lists, HTML Format, RTF and other registered formats), byte for
//! byte. Lossy: formats backed by GDI handles (CF_BITMAP, CF_PALETTE, CF_METAFILEPICT,
//! CF_ENHMETAFILE) and owner-display/private formats are not restored. CF_BITMAP comes back
//! anyway, because Windows synthesizes it from the restored CF_DIB; delayed-rendered formats are
//! rendered when read, so they come back as plain data.

use std::thread;
use std::time::Duration;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard,
    SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    VIRTUAL_KEY, VK_C, VK_CONTROL, VK_LMENU, VK_LSHIFT, VK_RMENU, VK_RSHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, HWND_MESSAGE, WINDOW_EX_STYLE, WINDOW_STYLE,
};

use crate::platform::clipboard::Pasteboard;

const CF_BITMAP: u32 = 2;
const CF_METAFILEPICT: u32 = 3;
const CF_PALETTE: u32 = 9;
const CF_UNICODETEXT: u32 = 13;
const CF_ENHMETAFILE: u32 = 14;
const CF_OWNERDISPLAY: u32 = 0x0080;
const CF_DSPBITMAP: u32 = 0x0082;
const CF_DSPMETAFILEPICT: u32 = 0x0083;
const CF_DSPENHMETAFILE: u32 = 0x008E;
/// CF_PRIVATEFIRST..=CF_PRIVATELAST and CF_GDIOBJFIRST..=CF_GDIOBJLAST hold handles, not data.
const HANDLE_RANGES: [(u32, u32); 2] = [(0x0200, 0x02FF), (0x0300, 0x03FF)];

/// Another app may hold the clipboard for a moment (clipboard managers do).
const OPEN_TRIES: u32 = 5;
const OPEN_RETRY: Duration = Duration::from_millis(10);

fn restorable(format: u32) -> bool {
    !matches!(
        format,
        CF_BITMAP
            | CF_METAFILEPICT
            | CF_PALETTE
            | CF_ENHMETAFILE
            | CF_OWNERDISPLAY
            | CF_DSPBITMAP
            | CF_DSPMETAFILEPICT
            | CF_DSPENHMETAFILE
    ) && !HANDLE_RANGES.iter().any(|(a, b)| (*a..=*b).contains(&format))
}

/// The clipboard, open for the lifetime of the guard.
struct Open;

impl Open {
    /// `owner` is required before `EmptyClipboard`: emptying a clipboard opened without a window
    /// leaves it ownerless, and `SetClipboardData` then fails, so the restore would wipe it.
    fn new(owner: Option<HWND>) -> Option<Self> {
        for i in 0..OPEN_TRIES {
            if i > 0 {
                thread::sleep(OPEN_RETRY);
            }
            if unsafe { OpenClipboard(owner) }.is_ok() {
                return Some(Open);
            }
        }
        None
    }
}

impl Drop for Open {
    fn drop(&mut self) {
        let _ = unsafe { CloseClipboard() };
    }
}

/// A hidden message-only window to own the clipboard while restoring it. Nothing is delay-rendered,
/// so the data stays on the clipboard after the window is destroyed.
struct Owner(HWND);

impl Owner {
    fn new() -> Option<Self> {
        unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("STATIC"),
                PCWSTR::null(),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                None,
                None,
            )
        }
        .ok()
        .map(Owner)
    }
}

impl Drop for Owner {
    fn drop(&mut self) {
        let _ = unsafe { DestroyWindow(self.0) };
    }
}

/// Copies the bytes behind a clipboard `HGLOBAL`.
unsafe fn global_bytes(h: HANDLE) -> Option<Vec<u8>> {
    let g = HGLOBAL(h.0);
    let size = GlobalSize(g);
    let ptr = GlobalLock(g) as *const u8;
    if ptr.is_null() {
        return None;
    }
    let bytes = std::slice::from_raw_parts(ptr, size).to_vec();
    let _ = GlobalUnlock(g);
    Some(bytes)
}

pub struct Clipboard;

impl Pasteboard for Clipboard {
    /// (format, bytes) for every restorable format.
    type Snapshot = Vec<(u32, Vec<u8>)>;

    fn change_count(&self) -> i64 {
        unsafe { GetClipboardSequenceNumber() as i64 }
    }

    fn snapshot(&self) -> Self::Snapshot {
        let Some(_open) = Open::new(None) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let mut format = 0;
        loop {
            format = unsafe { EnumClipboardFormats(format) };
            if format == 0 {
                break;
            }
            if !restorable(format) {
                continue;
            }
            if let Some(bytes) = unsafe { GetClipboardData(format) }
                .ok()
                .and_then(|h| unsafe { global_bytes(h) })
            {
                out.push((format, bytes));
            }
        }
        out
    }

    fn restore(&self, snapshot: Self::Snapshot) {
        // Declared first so it is dropped last, after the clipboard is closed.
        let Some(owner) = Owner::new() else { return };
        let Some(_open) = Open::new(Some(owner.0)) else { return };
        unsafe {
            let _ = EmptyClipboard();
            for (format, bytes) in snapshot {
                let Ok(g) = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1)) else {
                    continue;
                };
                let ptr = GlobalLock(g) as *mut u8;
                if ptr.is_null() {
                    let _ = GlobalFree(Some(g));
                    continue;
                }
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
                let _ = GlobalUnlock(g);
                // On success the clipboard owns the memory.
                if SetClipboardData(format, Some(HANDLE(g.0))).is_err() {
                    let _ = GlobalFree(Some(g));
                }
            }
        }
    }

    fn read_text(&self) -> Option<String> {
        let _open = Open::new(None)?;
        let bytes = unsafe { global_bytes(GetClipboardData(CF_UNICODETEXT).ok()?) }?;
        let units: Vec<u16> = bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes(*c))
            .take_while(|&u| u != 0)
            .collect();
        Some(String::from_utf16_lossy(&units))
    }

    fn send_copy(&self) -> bool {
        let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    ..Default::default()
                },
            },
        };
        // Ctrl goes down first, so releasing a held Alt (from the trigger shortcut) does not
        // count as an Alt tap and open the host app's menu bar. A held Win key is left alone: releasing it
        // synthetically can open the Start menu.
        let mut inputs = vec![key(VK_CONTROL, false)];
        for vk in [VK_LMENU, VK_RMENU, VK_LSHIFT, VK_RSHIFT] {
            if unsafe { GetAsyncKeyState(vk.0 as i32) } < 0 {
                inputs.push(key(vk, true));
            }
        }
        inputs.extend([key(VK_C, false), key(VK_C, true), key(VK_CONTROL, true)]);
        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        sent as usize == inputs.len()
    }
}
