//! API keys live in the OS credential store (macOS Keychain, Windows Credential Manager), never in
//! `settings.json`. The webview fetches a key right before each request (ADR 0003).

use keyring::Entry;

const SERVICE: &str = "dev.pointer.desktop";

/// Only provider keys may be read or written, so the webview cannot probe other entries.
fn entry(account: &str) -> Result<Entry, String> {
    let valid = account.strip_prefix("provider:").is_some_and(|id| {
        !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    });
    if !valid {
        return Err(format!("invalid secret account: {account}"));
    }
    Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn secret_get(account: String) -> Result<Option<String>, String> {
    match entry(&account)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn secret_set(account: String, value: String) -> Result<(), String> {
    entry(&account)?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn secret_delete(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::entry;

    #[test]
    fn only_provider_accounts_are_allowed() {
        assert!(entry("provider:abc-123").is_ok());
        assert!(entry("provider:").is_err());
        assert!(entry("other").is_err());
        assert!(entry("provider:../x").is_err());
    }
}
