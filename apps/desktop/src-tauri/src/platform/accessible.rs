//! Finding the app to capture from when its accessibility tree may still be switched off.
//!
//! Chromium and Electron apps only build their accessibility tree once an assistive client asks
//! for it: on macOS through `AXEnhancedUserInterface` (Chromium) or `AXManualAccessibility`
//! (Electron), on Windows by requesting the focused
//! window's accessible object (`WM_GETOBJECT`, which Chromium treats as a screen reader showing
//! up). Until then macOS may not even report them as the focused application, so capture fails
//! with `no-focused-element`. The fallback asks the window server for the frontmost app instead,
//! requests its tree, and polls the focused application again briefly. Accepted requests and
//! unsupported apps are cached; transient failures can be retried after a cooldown.
//!
//! The OS calls sit behind [`AxHost`] so the retry and caching logic is testable anywhere.

use std::collections::HashMap;
use std::thread;
use std::time::{Duration, Instant};

/// Polling after enabling the tree: ~80 ms at most.
pub const ENABLE_RETRIES: u32 = 4;
pub const ENABLE_INTERVAL: Duration = Duration::from_millis(20);
const ENABLE_RETRY_COOLDOWN: Duration = Duration::from_secs(3);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnableOutcome {
    Accepted,
    /// Returned by the macOS host when the app ignores AX enable; Windows never emits it.
    #[allow(dead_code)]
    Unsupported,
    Retry,
}

pub trait AxHost {
    /// The focused application according to the accessibility API.
    fn focused_app_pid(&self) -> Option<i32>;
    /// The frontmost application according to the window server.
    fn frontmost_pid(&self) -> Option<i32>;
    /// Asks the app to build its accessibility tree; apps that don't need it simply ignore it.
    fn enable_accessibility(&self, pid: i32) -> EnableOutcome;
}

/// Accepted/unsupported requests are terminal for this process; failed calls are not mistaken
/// for successful initialization. A cooldown prevents repeated Chromium enable requests from
/// continually restarting its two-second debounce.
#[derive(Default)]
pub struct ManualAccessibility(HashMap<i32, EnableState>);

struct EnableState {
    outcome: EnableOutcome,
    attempted: Instant,
}

impl ManualAccessibility {
    /// Requests initialization once, retrying transient failures after a cooldown. Returns true
    /// only for a newly accepted request, when the next reads may still come back empty.
    pub fn ensure(&mut self, host: &impl AxHost, pid: i32) -> bool {
        self.ensure_at(host, pid, Instant::now())
    }

    fn ensure_at(&mut self, host: &impl AxHost, pid: i32, now: Instant) -> bool {
        if let Some(state) = self.0.get(&pid) {
            if state.outcome != EnableOutcome::Retry
                || now.saturating_duration_since(state.attempted) < ENABLE_RETRY_COOLDOWN
            {
                return false;
            }
        }
        let outcome = host.enable_accessibility(pid);
        self.0.insert(
            pid,
            EnableState {
                outcome,
                attempted: now,
            },
        );
        outcome == EnableOutcome::Accepted
    }
}

pub struct Target {
    pub pid: i32,
    /// The tree was switched on during this capture.
    pub just_enabled: bool,
}

/// The app to capture from. The normal path is a single `focused_app_pid` call.
pub fn resolve_target(host: &impl AxHost, enabled: &mut ManualAccessibility) -> Option<Target> {
    if let Some(pid) = host.focused_app_pid() {
        let just_enabled = enabled.ensure(host, pid);
        return Some(Target { pid, just_enabled });
    }
    let frontmost = host.frontmost_pid()?;
    let just_enabled = enabled.ensure(host, frontmost);
    let pid = retry(ENABLE_RETRIES, ENABLE_INTERVAL, || host.focused_app_pid()).unwrap_or(frontmost);
    Some(Target {
        pid,
        just_enabled: just_enabled && pid == frontmost,
    })
}

/// Calls `f` up to `tries` times, sleeping `interval` before each retry.
pub fn retry<T>(tries: u32, interval: Duration, mut f: impl FnMut() -> Option<T>) -> Option<T> {
    for i in 0..tries {
        if i > 0 {
            thread::sleep(interval);
        }
        if let Some(v) = f() {
            return Some(v);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use super::*;

    #[derive(Default)]
    struct Fake {
        /// `focused_app_pid` answers `None` this many times, then `focused`.
        focused_after: Cell<u32>,
        focused: Option<i32>,
        frontmost: Option<i32>,
        enabled: RefCell<Vec<i32>>,
        focused_calls: Cell<u32>,
        enable_outcome: Cell<Option<EnableOutcome>>,
    }

    impl AxHost for Fake {
        fn focused_app_pid(&self) -> Option<i32> {
            self.focused_calls.set(self.focused_calls.get() + 1);
            let left = self.focused_after.get();
            if left > 0 {
                self.focused_after.set(left - 1);
                return None;
            }
            self.focused
        }
        fn frontmost_pid(&self) -> Option<i32> {
            self.frontmost
        }
        fn enable_accessibility(&self, pid: i32) -> EnableOutcome {
            self.enabled.borrow_mut().push(pid);
            self.enable_outcome.get().unwrap_or(EnableOutcome::Accepted)
        }
    }

    #[test]
    fn normal_app_takes_one_lookup() {
        let host = Fake {
            focused: Some(7),
            frontmost: Some(7),
            ..Default::default()
        };
        let mut cache = ManualAccessibility::default();
        let t = resolve_target(&host, &mut cache).unwrap();
        assert_eq!((t.pid, t.just_enabled), (7, true));
        assert_eq!(host.focused_calls.get(), 1);
        let t = resolve_target(&host, &mut cache).unwrap();
        assert!(!t.just_enabled);
        assert!(!cache.ensure_at(&host, 7, Instant::now() + Duration::from_secs(60)));
        assert_eq!(*host.enabled.borrow(), vec![7]);
    }

    #[test]
    fn electron_app_is_enabled_then_found() {
        let host = Fake {
            focused_after: Cell::new(2),
            focused: Some(42),
            frontmost: Some(42),
            ..Default::default()
        };
        let t = resolve_target(&host, &mut ManualAccessibility::default()).unwrap();
        assert_eq!((t.pid, t.just_enabled), (42, true));
        assert_eq!(*host.enabled.borrow(), vec![42]);
        assert_eq!(host.focused_calls.get(), 3);
    }

    #[test]
    fn falls_back_to_frontmost_when_still_unfocused() {
        let host = Fake {
            frontmost: Some(9),
            ..Default::default()
        };
        let mut cache = ManualAccessibility::default();
        let t = resolve_target(&host, &mut cache).unwrap();
        assert_eq!(t.pid, 9);
        assert_eq!(host.focused_calls.get(), 1 + ENABLE_RETRIES);
        resolve_target(&host, &mut cache).unwrap();
        assert_eq!(*host.enabled.borrow(), vec![9], "enabled once per process");
    }

    #[test]
    fn nothing_frontmost_gives_up() {
        let host = Fake::default();
        assert!(resolve_target(&host, &mut ManualAccessibility::default()).is_none());
        assert!(host.enabled.borrow().is_empty());
    }

    #[test]
    fn transient_enable_failure_retries_after_cooldown_then_caches_success() {
        let host = Fake {
            enable_outcome: Cell::new(Some(EnableOutcome::Retry)),
            ..Default::default()
        };
        let mut cache = ManualAccessibility::default();
        let now = Instant::now();
        assert!(!cache.ensure_at(&host, 42, now));
        assert!(!cache.ensure_at(&host, 42, now + ENABLE_RETRY_COOLDOWN - Duration::from_millis(1)));
        assert_eq!(*host.enabled.borrow(), vec![42]);

        host.enable_outcome.set(Some(EnableOutcome::Accepted));
        assert!(cache.ensure_at(&host, 42, now + ENABLE_RETRY_COOLDOWN));
        assert!(!cache.ensure_at(&host, 42, now + ENABLE_RETRY_COOLDOWN * 2));
        assert_eq!(*host.enabled.borrow(), vec![42, 42]);
    }

    #[test]
    fn unsupported_apps_are_not_hammered_and_do_not_claim_initialization() {
        let host = Fake {
            enable_outcome: Cell::new(Some(EnableOutcome::Unsupported)),
            ..Default::default()
        };
        let mut cache = ManualAccessibility::default();
        let now = Instant::now();
        assert!(!cache.ensure_at(&host, 7, now));
        assert!(!cache.ensure_at(&host, 7, now + Duration::from_secs(60)));
        assert_eq!(*host.enabled.borrow(), vec![7]);
        assert!(!cache.ensure_at(&host, 8, now));
        assert_eq!(*host.enabled.borrow(), vec![7, 8]);
    }

    #[test]
    fn retry_stops_at_first_hit() {
        let mut n = 0;
        assert_eq!(
            retry(5, Duration::ZERO, || {
                n += 1;
                (n == 3).then_some(n)
            }),
            Some(3)
        );
        assert_eq!(retry(2, Duration::ZERO, || None::<()>), None);
    }
}
