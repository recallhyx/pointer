//! AX call metadata only: never store returned text, URLs or accessibility-tree contents.

use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AxCall {
    pub operation: &'static str,
    pub attribute: String,
    pub code: i32,
    pub name: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_issue: Option<&'static str>,
}

impl AxCall {
    pub fn new(operation: &'static str, attribute: &str, code: i32) -> Self {
        Self {
            operation,
            attribute: attribute.to_string(),
            code,
            name: error_name(code),
            value_issue: None,
        }
    }

    /// Preserve a successful native code when the returned value is absent or unusable.
    pub fn with_value_issue(mut self, issue: &'static str) -> Self {
        self.value_issue = Some(issue);
        self
    }
}

fn error_name(code: i32) -> &'static str {
    match code {
        0 => "kAXErrorSuccess",
        -25200 => "kAXErrorFailure",
        -25201 => "kAXErrorIllegalArgument",
        -25202 => "kAXErrorInvalidUIElement",
        -25203 => "kAXErrorInvalidUIElementObserver",
        -25204 => "kAXErrorCannotComplete",
        -25205 => "kAXErrorAttributeUnsupported",
        -25206 => "kAXErrorActionUnsupported",
        -25207 => "kAXErrorNotificationUnsupported",
        -25208 => "kAXErrorNotImplemented",
        -25209 => "kAXErrorNotificationAlreadyRegistered",
        -25210 => "kAXErrorNotificationNotRegistered",
        -25211 => "kAXErrorAPIDisabled",
        -25212 => "kAXErrorNoValue",
        -25213 => "kAXErrorParameterizedAttributeUnsupported",
        -25214 => "kAXErrorNotEnoughPrecision",
        _ => "UnknownAXError",
    }
}

#[derive(Default, Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AxCaptureDiagnostics {
    pub trusted: bool,
    pub attempts: u32,
    pub enable_attempted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focused_application: Option<AxCall>,
    /// Most recent enable result for this process, including a cached first attempt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_accessibility: Option<AxCall>,
    /// All enable attribute attempts, including an unsupported primary before a fallback.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub enable_calls: Vec<AxCall>,
    /// Chromium's role query also activates native accessibility; never store the role value.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_role: Option<AxCall>,
    pub initializing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection_failure: Option<AxCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focused_element_failure: Option<AxCall>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_native_error_codes_and_sdk_names() {
        for (code, name) in [
            (-25204, "kAXErrorCannotComplete"),
            (-25205, "kAXErrorAttributeUnsupported"),
            (-25211, "kAXErrorAPIDisabled"),
            (-25212, "kAXErrorNoValue"),
            (-99999, "UnknownAXError"),
        ] {
            let call = AxCall::new("AXUIElementCopyAttributeValue", "AXFocusedUIElement", code);
            assert_eq!(call.code, code);
            assert_eq!(call.name, name);
            assert_eq!(call.value_issue, None);
        }
    }

    #[test]
    fn successful_but_empty_values_are_not_fabricated_native_errors() {
        let call =
            AxCall::new("AXUIElementCopyAttributeValue", "AXSelectedText", 0).with_value_issue("empty-selection");
        let json = serde_json::to_value(call).unwrap();
        assert_eq!(json["code"], 0);
        assert_eq!(json["name"], "kAXErrorSuccess");
        assert_eq!(json["valueIssue"], "empty-selection");
    }

    #[test]
    fn enable_result_is_logged_without_returned_attribute_values() {
        let diagnostics = AxCaptureDiagnostics {
            trusted: true,
            attempts: 2,
            enable_attempted: true,
            enable_accessibility: Some(AxCall::new(
                "AXUIElementSetAttributeValue",
                "AXManualAccessibility",
                -25205,
            )),
            selection_failure: Some(AxCall::new(
                "AXUIElementCopyAttributeValue",
                "AXFocusedUIElement",
                -25212,
            )),
            ..Default::default()
        };
        let json = serde_json::to_value(diagnostics).unwrap();
        assert_eq!(json["enableAccessibility"]["code"], -25205);
        assert_eq!(json["selectionFailure"]["code"], -25212);
        assert_eq!(json["trusted"], true);
        assert_eq!(json["attempts"], 2);
        assert_eq!(json["enableAttempted"], true);
        assert!(json["selectionFailure"].get("text").is_none());
        assert!(json["selectionFailure"].get("value").is_none());
        assert!(json.get("focusedApplication").is_none());
    }

    #[test]
    fn fallback_diagnostics_preserve_primary_and_final_native_results() {
        let manual = AxCall::new("AXUIElementSetAttributeValue", "AXManualAccessibility", -25205);
        let enhanced = AxCall::new("AXUIElementSetAttributeValue", "AXEnhancedUserInterface", 0);
        let diagnostics = AxCaptureDiagnostics {
            enable_accessibility: Some(enhanced.clone()),
            enable_calls: vec![manual, enhanced],
            enable_role: Some(AxCall::new("AXUIElementCopyAttributeValue", "AXRole", 0)),
            initializing: true,
            // A later gesture uses the cached results, not another enable request.
            enable_attempted: false,
            ..Default::default()
        };
        let json = serde_json::to_value(diagnostics).unwrap();
        assert_eq!(json["enableCalls"][0]["attribute"], "AXManualAccessibility");
        assert_eq!(json["enableCalls"][0]["code"], -25205);
        assert_eq!(json["enableCalls"][1]["attribute"], "AXEnhancedUserInterface");
        assert_eq!(json["enableCalls"][1]["code"], 0);
        assert_eq!(json["enableAccessibility"]["code"], 0);
        assert_eq!(json["enableRole"]["attribute"], "AXRole");
        assert_eq!(json["initializing"], true);
        assert_eq!(json["enableAttempted"], false);
        assert!(json["enableRole"].get("value").is_none());
    }

    #[test]
    fn enriched_capture_error_preserves_classification_and_host() {
        use crate::env::AppInfo;
        use crate::platform::CaptureError;

        let error = CaptureError::WithAxDiagnostics {
            error: Box::new(CaptureError::NoFocusedElement {
                app: Some(AppInfo {
                    name: Some("Google Chrome".into()),
                    ..Default::default()
                }),
            }),
            diagnostics: Box::new(AxCaptureDiagnostics {
                selection_failure: Some(AxCall::new(
                    "AXUIElementCopyAttributeValue",
                    "AXFocusedUIElement",
                    -25204,
                )),
                ..Default::default()
            }),
        };
        assert_eq!(error.code(), "no-focused-element");
        assert_eq!(error.app().unwrap().name.as_deref(), Some("Google Chrome"));
        assert_eq!(error.ax_diagnostics().unwrap()["selectionFailure"]["code"], -25204);
        assert!(CaptureError::Unsupported.ax_diagnostics().is_none());
    }
}
