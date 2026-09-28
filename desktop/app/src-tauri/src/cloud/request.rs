//! The window's one authenticated call to the platform, for the surfaces Synapse renders
//! from the shared React UI (the Evermind console): they speak the platform's REST paths
//! directly, the way the same components do inside the VS Code extension, but the key and
//! its short-lived token never reach the page — every call goes out through the session.
//!
//! Only the platform's API and model catalog are reachable, with the person's own rights:
//! the platform authorises each call exactly as it would from the web app.

use super::{Cloud, Res};
use crate::pool::blocking;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

/// Training, audits and readiness probes run in the request; give them the time they take.
const TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// A path the window may call: under `/api/` or `/llm/v1/`, with nothing that could climb
/// out of them or point at another host.
fn allowed(path: &str) -> bool {
    (path.starts_with("/api/") || path.starts_with("/llm/v1/")) && !path.contains("..") && !path.contains("//") && !path.contains('\\')
}

#[tauri::command]
pub async fn cloud_request(cloud: State<'_, Arc<Cloud>>, method: String, path: String, body: Option<Value>) -> Res<Value> {
    let method = method.to_ascii_uppercase();
    if !matches!(method.as_str(), "GET" | "POST" | "PATCH" | "PUT" | "DELETE") {
        return Err(format!("method {method} is not allowed"));
    }
    if !allowed(&path) {
        return Err(format!("path {path} is not allowed"));
    }
    blocking(cloud, move |c| {
        let s = c.require()?;
        s.api_with_timeout(&method, &path, body, TIMEOUT).map_err(|e| c.fail(e))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::allowed;

    #[test]
    fn only_the_platform_api_and_model_catalog_are_reachable() {
        assert!(allowed("/api/projects/7/evermind/contributions"));
        assert!(allowed("/llm/v1/models"));
        assert!(!allowed("/activate"));
        assert!(!allowed("https://example.com/api/x"));
        assert!(!allowed("/api/../auth/device/token"));
        assert!(!allowed("/api//evil.example"));
        assert!(!allowed("/api\\x"));
    }
}
