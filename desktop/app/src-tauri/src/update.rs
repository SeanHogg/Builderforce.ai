//! Update notice: the newest `desktop-v*` GitHub release versus this build. The app points
//! the person at the download; installing is theirs to do (a signed in-place updater
//! needs the release signing key — see the Gap Register).

use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const RELEASES_API: &str = "https://api.github.com/repos/SeanHogg/Builderforce.ai/releases?per_page=30";
pub const TAG_PREFIX: &str = "desktop-v";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: Option<String>,
    pub url: Option<String>,
    pub newer: bool,
}

pub fn check() -> UpdateInfo {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let latest = ureq::get(RELEASES_API)
        .set("User-Agent", "synapse")
        .set("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(8))
        .call()
        .ok()
        .and_then(|r| r.into_json::<Value>().ok())
        .and_then(|v| newest_desktop_release(&v));
    let newer = latest.as_ref().map(|(v, _)| is_newer(v, &current)).unwrap_or(false);
    UpdateInfo { current, latest: latest.as_ref().map(|(v, _)| v.clone()), url: latest.map(|(_, u)| u), newer }
}

fn newest_desktop_release(releases: &Value) -> Option<(String, String)> {
    releases.as_array()?.iter().find_map(|r| {
        if r.get("draft").and_then(Value::as_bool).unwrap_or(false) {
            return None;
        }
        let tag = r.get("tag_name")?.as_str()?;
        let version = tag.strip_prefix(TAG_PREFIX)?;
        let url = r.get("html_url")?.as_str()?;
        Some((version.to_string(), url.to_string()))
    })
}

/// Date versions (`2026.9.26`, `2026.10.1`) compared numerically, part by part.
pub fn is_newer(candidate: &str, current: &str) -> bool {
    let parts = |s: &str| -> Vec<u64> {
        s.split(['.', '-']).map(|p| p.parse().unwrap_or(0)).collect()
    };
    parts(candidate) > parts(current)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn numeric_date_versions() {
        assert!(is_newer("2026.10.1", "2026.9.26"));
        assert!(!is_newer("2026.9.26", "2026.9.26"));
        assert!(!is_newer("2026.9.3", "2026.9.26"));
    }

    #[test]
    fn picks_first_published_desktop_tag() {
        let v = json!([
            { "tag_name": "v2026.9.30", "draft": false, "html_url": "a" },
            { "tag_name": "desktop-v2026.10.2", "draft": true, "html_url": "b" },
            { "tag_name": "desktop-v2026.10.1", "draft": false, "html_url": "c" }
        ]);
        assert_eq!(newest_desktop_release(&v), Some(("2026.10.1".into(), "c".into())));
    }
}
