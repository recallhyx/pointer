//! Environment = where the user is reading the selection. Capture lives in `platform`; this
//! module holds the platform-independent rules from ADR 0004 (which apps count as browsers and
//! how titles, URLs and document paths are cleaned before they reach the model).

use serde::Serialize;

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: Option<String>,
    /// Bundle identifier on macOS, executable file name on Windows.
    pub id: Option<String>,
    #[serde(skip)]
    pub pid: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub url: Option<String>,
    pub document_name: Option<String>,
}

const MAX_TITLE_CHARS: usize = 200;
const MAX_URL_CHARS: usize = 300;

const BROWSERS: &[&str] = &[
    // macOS bundle identifiers
    "com.google.chrome",
    "com.google.chrome.canary",
    "com.microsoft.edgemac",
    "com.apple.safari",
    "com.apple.safaritechnologypreview",
    "org.mozilla.firefox",
    "org.mozilla.firefoxdeveloperedition",
    "company.thebrowser.browser",
    "com.brave.browser",
    "com.vivaldi.vivaldi",
    "com.operasoftware.opera",
    "org.chromium.chromium",
    // Windows executables
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "brave.exe",
    "vivaldi.exe",
    "opera.exe",
    "arc.exe",
    "chromium.exe",
    "360se.exe",
    "360chrome.exe",
    "qqbrowser.exe",
    "sogouexplorer.exe",
];

const BROWSER_TITLE_SUFFIXES: &[&str] = &[
    "Google Chrome",
    "Microsoft\u{200b} Edge",
    "Microsoft Edge",
    "Mozilla Firefox",
    "Firefox",
    "Brave",
    "Vivaldi",
    "Opera",
    "Chromium",
    "Safari",
    "Arc",
];

pub fn is_browser(app_id: Option<&str>) -> bool {
    app_id.is_some_and(|id| BROWSERS.contains(&id.to_ascii_lowercase().as_str()))
}

#[cfg_attr(windows, allow(dead_code))]
pub fn is_firefox(app_id: Option<&str>) -> bool {
    app_id.is_some_and(|id| {
        let id = id.to_ascii_lowercase();
        id.starts_with("org.mozilla.firefox") || id == "firefox.exe"
    })
}

pub fn sanitize(raw: Environment) -> Environment {
    let app_name = raw.app_name.map(|s| collapse_whitespace(&s)).filter(|s| !s.is_empty());
    let window_title = raw
        .window_title
        .map(|t| clean_title(&t, app_name.as_deref()))
        .filter(|t| !t.is_empty())
        .filter(|t| app_name.as_deref().is_none_or(|a| !t.eq_ignore_ascii_case(a)));
    Environment {
        url: raw.url.as_deref().and_then(clean_url),
        document_name: raw.document_name.as_deref().and_then(file_name_only),
        app_name,
        window_title,
    }
}

fn collapse_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

fn clean_title(title: &str, app_name: Option<&str>) -> String {
    let mut t = collapse_whitespace(title);
    let suffixes = app_name.into_iter().chain(BROWSER_TITLE_SUFFIXES.iter().copied());
    'outer: for suffix in suffixes {
        for sep in [" - ", " — ", " – "] {
            let tail = format!("{sep}{suffix}");
            if t.len() > tail.len() && t.ends_with(&tail) {
                t.truncate(t.len() - tail.len());
                break 'outer;
            }
        }
    }
    truncate_chars(t.trim(), MAX_TITLE_CHARS)
}

/// Keeps scheme + host + path of http(s) URLs. Query strings and fragments often carry tokens,
/// search terms and tracking ids, so they never leave the machine.
fn clean_url(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let candidate = if raw.contains("://") {
        raw.to_string()
    } else if !raw.is_empty() && !raw.contains(' ') && raw.contains('.') {
        // Firefox's address bar sometimes omits the scheme.
        format!("https://{raw}")
    } else {
        return None;
    };
    let mut url = url::Url::parse(&candidate).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return None;
    }
    url.set_query(None);
    url.set_fragment(None);
    let _ = url.set_username("");
    let _ = url.set_password(None);
    Some(truncate_chars(url.as_str(), MAX_URL_CHARS))
}

/// `AXDocument` is a file URL on macOS; editors sometimes report a plain path.
fn file_name_only(raw: &str) -> Option<String> {
    let path = match url::Url::parse(raw) {
        Ok(u) if u.scheme() == "file" => u.path().to_string(),
        // A one-letter "scheme" is a Windows drive letter.
        Ok(u) if u.scheme().len() > 1 => return None,
        _ => raw.to_string(),
    };
    let decoded = percent_encoding::percent_decode_str(&path)
        .decode_utf8_lossy()
        .to_string();
    let name = decoded.rsplit(['/', '\\']).next()?.trim();
    (!name.is_empty()).then(|| truncate_chars(name, MAX_TITLE_CHARS))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(app: &str, title: &str, url: Option<&str>, doc: Option<&str>) -> Environment {
        Environment {
            app_name: Some(app.into()),
            window_title: Some(title.into()),
            url: url.map(Into::into),
            document_name: doc.map(Into::into),
        }
    }

    #[test]
    fn strips_query_fragment_and_credentials() {
        let e = sanitize(env(
            "Google Chrome",
            "x",
            Some("https://user:pw@doc.rust-lang.org/book/ch04-02.html?token=abc#borrow"),
            None,
        ));
        assert_eq!(e.url.as_deref(), Some("https://doc.rust-lang.org/book/ch04-02.html"));
    }

    #[test]
    fn drops_non_http_urls_and_adds_missing_scheme() {
        assert_eq!(clean_url("file:///Users/me/a.html"), None);
        assert_eq!(clean_url("chrome://settings"), None);
        assert_eq!(clean_url("search words here"), None);
        assert_eq!(
            clean_url("github.com/tauri-apps/tauri?tab=readme").as_deref(),
            Some("https://github.com/tauri-apps/tauri")
        );
    }

    #[test]
    fn strips_browser_suffix_from_title() {
        let e = sanitize(env(
            "Google Chrome",
            "References and Borrowing - Google Chrome",
            None,
            None,
        ));
        assert_eq!(e.window_title.as_deref(), Some("References and Borrowing"));
        let e = sanitize(env(
            "Microsoft Edge",
            "Bing - Personal - Microsoft\u{200b} Edge",
            None,
            None,
        ));
        assert_eq!(e.window_title.as_deref(), Some("Bing - Personal"));
        let e = sanitize(env("Firefox", "MDN Web Docs — Mozilla Firefox", None, None));
        assert_eq!(e.window_title.as_deref(), Some("MDN Web Docs"));
    }

    #[test]
    fn omits_title_equal_to_app_name() {
        let e = sanitize(env("微信", "微信", None, None));
        assert_eq!(e.window_title, None);
        assert_eq!(e.app_name.as_deref(), Some("微信"));
    }

    #[test]
    fn truncates_long_titles() {
        let long = "长".repeat(250);
        let e = sanitize(env("App", &long, None, None));
        assert_eq!(e.window_title.unwrap().chars().count(), MAX_TITLE_CHARS + 1);
    }

    #[test]
    fn keeps_only_the_file_name() {
        assert_eq!(
            file_name_only("file:///Users/me/Projects/pointer/src/main%20copy.rs").as_deref(),
            Some("main copy.rs")
        );
        assert_eq!(
            file_name_only(r"C:\Users\me\Documents\报告.docx").as_deref(),
            Some("报告.docx")
        );
        assert_eq!(file_name_only("https://example.com/a.pdf"), None);
    }

    #[test]
    fn recognises_browsers() {
        assert!(is_browser(Some("com.google.Chrome")));
        assert!(is_browser(Some("MSEDGE.EXE")));
        assert!(!is_browser(Some("com.microsoft.VSCode")));
        assert!(!is_browser(None));
        assert!(is_firefox(Some("org.mozilla.firefoxdeveloperedition")));
    }
}
