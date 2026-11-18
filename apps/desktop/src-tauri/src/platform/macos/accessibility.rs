//! Chromium and Electron use different activation attributes. Keep the protocol independent of
//! native calls so fallback, diagnostics and transient failure handling can be tested together.

use std::time::{Duration, Instant};

use super::super::accessible::EnableOutcome;
use super::super::ax_diagnostics::AxCall;

const MANUAL: &str = "AXManualAccessibility";
const ENHANCED: &str = "AXEnhancedUserInterface";
// Chromium debounces enhanced-mode activation for two seconds. Keep reads retrying within the
// caller's existing deadline during that window, without ever resending an accepted enable.
const INITIALIZATION_WINDOW: Duration = Duration::from_millis(2500);

pub struct EnableAttempt {
    pub calls: Vec<AxCall>,
    pub role: Option<AxCall>,
    pub outcome: EnableOutcome,
    completed: Instant,
}

impl EnableAttempt {
    pub fn initializing(&self, now: Instant) -> bool {
        self.outcome == EnableOutcome::Accepted && now.saturating_duration_since(self.completed) < INITIALIZATION_WINDOW
    }
}

fn is_chromium(app_id: Option<&str>) -> bool {
    app_id.is_some_and(|id| {
        let id = id.to_ascii_lowercase();
        [
            "com.google.chrome",
            "org.chromium.chromium",
            "com.microsoft.edgemac",
            "com.brave.browser",
            "com.vivaldi.vivaldi",
            "com.operasoftware.opera",
            "company.thebrowser.browser",
        ]
        .iter()
        .any(|prefix| id == *prefix || id.starts_with(&format!("{prefix}.")))
    })
}

fn unsupported(code: i32) -> bool {
    matches!(code, -25205 | -25208)
}

pub fn enable(
    app_id: Option<&str>,
    mut set: impl FnMut(&str) -> AxCall,
    read_role: impl FnOnce() -> AxCall,
) -> EnableAttempt {
    let chromium = is_chromium(app_id);
    let (primary, fallback) = if chromium {
        (ENHANCED, MANUAL)
    } else {
        (MANUAL, ENHANCED)
    };
    let first = set(primary);
    let needs_fallback = unsupported(first.code);
    let mut calls = vec![first];
    if needs_fallback {
        calls.push(set(fallback));
    }
    // Reading AXRole activates Chromium's general native AX mode without waiting for the
    // enhanced-mode debounce. Electron's successful manual path needs no additional call.
    let role = (chromium || calls.iter().any(|call| call.attribute == ENHANCED)).then(read_role);
    let outcome = if calls.iter().any(|call| call.code == 0) {
        EnableOutcome::Accepted
    } else if calls.iter().all(|call| unsupported(call.code)) {
        EnableOutcome::Unsupported
    } else {
        EnableOutcome::Retry
    };
    EnableAttempt {
        calls,
        role,
        outcome,
        completed: Instant::now(),
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;

    fn call(attribute: &str, code: i32) -> AxCall {
        AxCall::new("AXUIElementSetAttributeValue", attribute, code)
    }

    fn role() -> AxCall {
        AxCall::new("AXUIElementCopyAttributeValue", "AXRole", 0)
    }

    #[test]
    fn chrome_and_channels_use_enhanced_and_prime_role() {
        for id in ["com.google.Chrome", "com.google.Chrome.canary", "org.chromium.Chromium"] {
            let attempt = enable(Some(id), |attribute| call(attribute, 0), role);
            assert_eq!(attempt.calls.len(), 1);
            assert_eq!(attempt.calls[0].attribute, ENHANCED);
            assert_eq!(attempt.outcome, EnableOutcome::Accepted);
            assert_eq!(attempt.role.unwrap().attribute, "AXRole");
        }
    }

    #[test]
    fn electron_retains_manual_without_enhanced_side_effects() {
        let role_calls = Cell::new(0);
        for id in [Some("com.microsoft.VSCode"), Some("com.tinyspeck.slackmacgap"), None] {
            let attempt = enable(
                id,
                |attribute| call(attribute, 0),
                || {
                    role_calls.set(role_calls.get() + 1);
                    role()
                },
            );
            assert_eq!(attempt.calls.len(), 1);
            assert_eq!(attempt.calls[0].attribute, MANUAL);
            assert_eq!(attempt.outcome, EnableOutcome::Accepted);
        }
        assert_eq!(role_calls.get(), 0);
    }

    #[test]
    fn unknown_chromium_app_falls_back_and_preserves_both_codes() {
        let attempt = enable(
            Some("com.example.browser"),
            |attribute| call(attribute, if attribute == MANUAL { -25205 } else { 0 }),
            role,
        );
        assert_eq!(attempt.outcome, EnableOutcome::Accepted);
        assert_eq!(attempt.calls[0].attribute, MANUAL);
        assert_eq!(attempt.calls[0].code, -25205);
        assert_eq!(attempt.calls[1].attribute, ENHANCED);
        assert_eq!(attempt.calls[1].code, 0);
        assert!(attempt.role.is_some());
    }

    #[test]
    fn old_chromium_can_fall_back_to_manual() {
        let attempt = enable(
            Some("com.google.Chrome"),
            |attribute| call(attribute, if attribute == ENHANCED { -25205 } else { 0 }),
            role,
        );
        assert_eq!(attempt.outcome, EnableOutcome::Accepted);
        assert_eq!(attempt.calls[1].attribute, MANUAL);
        assert!(attempt.role.is_some());
    }

    #[test]
    fn transient_failures_do_not_trigger_another_setter() {
        for code in [-25204, -25202, -25211] {
            let attempt = enable(Some("com.google.Chrome"), |attribute| call(attribute, code), role);
            assert_eq!(attempt.outcome, EnableOutcome::Retry);
            assert_eq!(attempt.calls.len(), 1);
            assert_eq!(attempt.calls[0].code, code);
        }
    }

    #[test]
    fn unsupported_setters_do_not_claim_success_even_when_role_succeeds() {
        let attempt = enable(None, |attribute| call(attribute, -25205), role);
        assert_eq!(attempt.outcome, EnableOutcome::Unsupported);
        assert_eq!(attempt.calls.len(), 2);
        assert_eq!(attempt.role.unwrap().code, 0);
    }

    #[test]
    fn retries_during_initialization_are_bounded_and_do_not_reenable() {
        let attempt = enable(Some("com.google.Chrome"), |attribute| call(attribute, 0), role);
        assert!(attempt.initializing(attempt.completed));
        assert!(attempt.initializing(attempt.completed + Duration::from_secs(2)));
        assert!(!attempt.initializing(attempt.completed + INITIALIZATION_WINDOW));
        let failed = enable(Some("com.google.Chrome"), |attribute| call(attribute, -25204), role);
        assert!(!failed.initializing(failed.completed));
    }
}
