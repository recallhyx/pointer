//! Clipboard fallback for apps whose accessibility API exposes no selected text (self-drawn UI,
//! 企业微信 and the like): send the copy shortcut, read the text the host app put on the
//! clipboard, then put the user's previous clipboard back, every item and every type.
//!
//! Only used after the accessibility path came back without text, and never for excluded apps;
//! the controller decides that. The OS calls sit behind [`Pasteboard`] so the change detection
//! and restore logic is testable anywhere.

use std::thread;
use std::time::{Duration, Instant};

/// How long to wait for the host app to answer the copy shortcut.
pub const COPY_TIMEOUT: Duration = Duration::from_millis(150);
/// After giving up, how much longer to watch for a slow host app (Electron, 企业微信) writing
/// anyway, so the user's clipboard can still be put back.
pub const LATE_WRITE_GRACE: Duration = Duration::from_millis(250);
pub const POLL_INTERVAL: Duration = Duration::from_millis(10);

pub trait Pasteboard {
    /// Everything on the clipboard, enough to put it back exactly.
    type Snapshot;
    /// Bumped by the OS on every write (`NSPasteboard.changeCount`, `GetClipboardSequenceNumber`).
    fn change_count(&self) -> i64;
    fn snapshot(&self) -> Self::Snapshot;
    fn restore(&self, snapshot: Self::Snapshot);
    fn read_text(&self) -> Option<String>;
    /// Posts Cmd+C / Ctrl+C to the frontmost app. Returns false if the event could not be sent.
    fn send_copy(&self) -> bool;
}

/// The selection as copied by the host app, or `None` when the copy changed nothing (no
/// selection, or the app ignores the shortcut) or produced no text.
///
/// A copy that lands after `timeout` but within `grace` is too late to use, but it still
/// overwrote the user's clipboard, so that is put back too.
pub fn copy_selection<P: Pasteboard>(pb: &P, timeout: Duration, grace: Duration, interval: Duration) -> Option<String> {
    let before = pb.change_count();
    let snapshot = pb.snapshot();
    if !pb.send_copy() {
        return None;
    }
    let start = Instant::now();
    if !wait_for_change(pb, before, start + timeout, interval) {
        if wait_for_change(pb, before, start + timeout + grace, interval) {
            pb.restore(snapshot);
        }
        return None;
    }
    let text = pb.read_text().filter(|t| !t.trim().is_empty());
    pb.restore(snapshot);
    text
}

/// Polls until the change count moves past `before`; false if `deadline` comes first.
fn wait_for_change<P: Pasteboard>(pb: &P, before: i64, deadline: Instant, interval: Duration) -> bool {
    while pb.change_count() == before {
        if Instant::now() + interval > deadline {
            return false;
        }
        thread::sleep(interval);
    }
    true
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use super::*;

    /// A clipboard whose "host app" writes `copied` after `delay` polls.
    struct Fake {
        count: Cell<i64>,
        contents: RefCell<Vec<String>>,
        copied: Option<Vec<String>>,
        delay: Cell<u32>,
        sent: Cell<bool>,
        restored: Cell<u32>,
        send_ok: bool,
    }

    impl Fake {
        fn new(contents: &[&str], copied: Option<&[&str]>, delay: u32) -> Self {
            let own = |v: &[&str]| v.iter().map(|s| s.to_string()).collect();
            Fake {
                count: Cell::new(5),
                contents: RefCell::new(own(contents)),
                copied: copied.map(own),
                delay: Cell::new(delay),
                sent: Cell::new(false),
                restored: Cell::new(0),
                send_ok: true,
            }
        }
    }

    impl Pasteboard for Fake {
        type Snapshot = Vec<String>;
        fn change_count(&self) -> i64 {
            if self.sent.get() {
                if let Some(c) = &self.copied {
                    match self.delay.get() {
                        0 if *self.contents.borrow() != *c => {
                            *self.contents.borrow_mut() = c.clone();
                            self.count.set(self.count.get() + 1);
                        }
                        0 => {}
                        d => self.delay.set(d - 1),
                    }
                }
            }
            self.count.get()
        }
        fn snapshot(&self) -> Vec<String> {
            self.contents.borrow().clone()
        }
        fn restore(&self, s: Vec<String>) {
            self.restored.set(self.restored.get() + 1);
            *self.contents.borrow_mut() = s;
            self.count.set(self.count.get() + 1);
        }
        fn read_text(&self) -> Option<String> {
            self.contents.borrow().first().cloned()
        }
        fn send_copy(&self) -> bool {
            self.sent.set(true);
            self.send_ok
        }
    }

    const T: Duration = Duration::from_millis(50);
    const G: Duration = Duration::from_millis(50);
    const I: Duration = Duration::from_millis(1);

    #[test]
    fn reads_copied_text_and_restores_every_item() {
        let pb = Fake::new(&["old", "old-rtf"], Some(&["selected"]), 3);
        assert_eq!(copy_selection(&pb, T, G, I).as_deref(), Some("selected"));
        assert_eq!(*pb.contents.borrow(), vec!["old", "old-rtf"]);
        assert_eq!(pb.restored.get(), 1);
    }

    #[test]
    fn unchanged_clipboard_means_no_text_and_no_restore() {
        let pb = Fake::new(&["old"], None, 0);
        assert_eq!(copy_selection(&pb, T, G, I), None);
        assert_eq!(pb.restored.get(), 0);
        assert_eq!(*pb.contents.borrow(), vec!["old"]);
    }

    #[test]
    fn blank_copy_is_no_text_but_still_restored() {
        let pb = Fake::new(&["old"], Some(&["  \n"]), 0);
        assert_eq!(copy_selection(&pb, T, G, I), None);
        assert_eq!(*pb.contents.borrow(), vec!["old"]);
    }

    #[test]
    fn failed_send_touches_nothing() {
        let mut pb = Fake::new(&["old"], Some(&["x"]), 0);
        pb.send_ok = false;
        assert_eq!(copy_selection(&pb, T, G, I), None);
        assert_eq!(pb.restored.get(), 0);
    }

    #[test]
    fn gives_up_after_timeout() {
        let pb = Fake::new(&["old"], Some(&["late"]), 10_000);
        let start = Instant::now();
        assert_eq!(copy_selection(&pb, Duration::from_millis(20), G, I), None);
        assert!(start.elapsed() < Duration::from_millis(300));
        assert_eq!(pb.restored.get(), 0);
    }

    #[test]
    fn a_late_copy_is_not_used_but_the_clipboard_is_put_back() {
        // Writes after 30 polls of at least 1ms each, so always past the 10ms timeout. The grace
        // is generous because a loaded CI runner can sleep far longer than 1ms per poll; the loop
        // stops as soon as the write lands, so the test stays fast.
        let pb = Fake::new(&["old", "old-rtf"], Some(&["late"]), 30);
        let grace = Duration::from_secs(2);
        assert_eq!(copy_selection(&pb, Duration::from_millis(10), grace, I), None);
        assert_eq!(pb.restored.get(), 1);
        assert_eq!(*pb.contents.borrow(), vec!["old", "old-rtf"]);
    }
}
