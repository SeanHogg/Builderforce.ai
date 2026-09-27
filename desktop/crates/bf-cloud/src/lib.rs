//! Synapse's client for builderforce.ai — the same account, workspaces, chats and agents
//! the web app and the VS Code extension use, over the same endpoints:
//!   - [`device`]: sign in through the browser (RFC 8628) — the platform mints a `bfk_`
//!     key named after this app, kept in the OS credential store ([`bf_vault`]);
//!   - [`Session`]: the key exchanged for a short-lived workspace token, refreshed before
//!     it expires, re-scoped to the chosen workspace, and every API call made with it;
//!   - [`Session::complete`]: the LLM gateway (the key itself is the gateway credential).
//!
//! Blocking by design (ureq): the app calls it from its blocking pool, never the UI thread.

pub mod device;
mod error;
mod session;

pub use error::CloudError;
pub use session::{Session, Workspace};

use std::time::Duration;

/// How this app names itself to the device flow (`DEVICE_CLIENTS` on the platform).
pub const CLIENT: &str = "synapse";
/// The credential-store entry holding the sign-in key.
pub const KEY_ENTRY: &str = "builderforce:apiKey";

pub(crate) const TIMEOUT: Duration = Duration::from_secs(20);

/// The gateway every API and LLM call goes through: `SYNAPSE_BUILDERFORCE_URL`, else
/// production. The VS Code extension's `builderforce.baseUrl` default, so both reach the
/// same place.
pub fn gateway_base() -> String {
    std::env::var("SYNAPSE_BUILDERFORCE_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "https://builderforce.ai/gateway".into())
        .trim_end_matches('/')
        .to_string()
}

/// The web app's origin, for links a person opens: the gateway's host without its path
/// (and without a leading `api.`), like the extension's `getWebBaseUrl`.
pub fn web_base() -> String {
    web_base_of(&gateway_base())
}

fn web_base_of(gateway: &str) -> String {
    let (scheme, rest) = gateway.split_once("://").unwrap_or(("https", gateway));
    let host = rest.split('/').next().unwrap_or(rest);
    let host = host.strip_prefix("api.").unwrap_or(host);
    format!("{scheme}://{host}")
}

/// The saved sign-in key, if any.
pub fn saved_key() -> Option<String> {
    bf_vault::load(KEY_ENTRY).filter(|k| !k.trim().is_empty())
}

pub fn save_key(key: &str) -> anyhow::Result<()> {
    bf_vault::save(KEY_ENTRY, key)
}

/// Forget the key here and revoke it on the platform (best effort — offline still signs out).
pub fn sign_out(key: &str) {
    bf_vault::delete(KEY_ENTRY);
    let _ = ureq::post(&format!("{}/api/auth/keys/revoke", gateway_base()))
        .timeout(TIMEOUT)
        .send_json(serde_json::json!({ "apiKey": key }));
}

#[cfg(test)]
mod tests {
    use super::web_base_of;

    #[test]
    fn web_base_drops_the_gateway_path_and_api_prefix() {
        assert_eq!(web_base_of("https://builderforce.ai/gateway"), "https://builderforce.ai");
        assert_eq!(web_base_of("https://api.builderforce.ai"), "https://builderforce.ai");
        assert_eq!(web_base_of("http://localhost:8787/gateway"), "http://localhost:8787");
    }
}
