//! The desktop apps' client for builderforce.ai — the same account, workspaces, chats and
//! agents the web app and the VS Code extension use, over the same endpoints:
//!   - [`device`]: sign in through the browser (RFC 8628) — the platform mints a `bfk_`
//!     key named after the app, kept in the OS credential store ([`bf_vault`]);
//!   - [`Account`]: the signed-in state an app window shows — the session, a sign-in in
//!     progress, the workspace in use — shared by every app so none re-implements it;
//!   - [`Session`]: the key exchanged for a short-lived workspace token, refreshed before
//!     it expires, re-scoped to the chosen workspace, and every API call made with it;
//!   - [`Session::complete`]: the LLM gateway (the key itself is the gateway credential).
//!
//! Each app names itself with an [`AppIdentity`] — Synapse and Spawn sign in separately,
//! with separate keys, so signing out of one never signs out of the other.
//!
//! Blocking by design (ureq): the app calls it from its blocking pool, never the UI thread.

pub mod account;
pub mod device;
mod error;
mod session;

pub use account::{Account, SignIn};
pub use error::CloudError;
pub use session::{Session, Workspace};

use std::time::Duration;

/// Who a desktop app is to the platform.
#[derive(Debug, Clone, Copy)]
pub struct AppIdentity {
    /// How the app names itself to the device flow (`DEVICE_CLIENTS` on the platform).
    pub client: &'static str,
    /// The credential-store entry holding its sign-in key.
    pub key_entry: &'static str,
    /// The thread names and messages it is called by.
    pub name: &'static str,
}

/// Synapse, the local context service. Its key entry predates the other apps and keeps
/// its original name, so an existing sign-in survives the upgrade.
pub const SYNAPSE: AppIdentity = AppIdentity { client: "synapse", key_entry: "builderforce:apiKey", name: "Synapse" };

/// Spawn, the Roblox game builder.
pub const SPAWN: AppIdentity = AppIdentity { client: "spawn", key_entry: "builderforce:spawn:apiKey", name: "Spawn" };

pub(crate) const TIMEOUT: Duration = Duration::from_secs(20);

/// The gateway every API and LLM call goes through: `BUILDERFORCE_URL` (or the older
/// `SYNAPSE_BUILDERFORCE_URL`), else production. The VS Code extension's
/// `builderforce.baseUrl` default, so every client reaches the same place.
pub fn gateway_base() -> String {
    ["BUILDERFORCE_URL", "SYNAPSE_BUILDERFORCE_URL"]
        .iter()
        .find_map(|name| std::env::var(name).ok().filter(|s| !s.trim().is_empty()))
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

/// The app's saved sign-in key, if any.
pub fn saved_key(app: &AppIdentity) -> Option<String> {
    bf_vault::load(app.key_entry).filter(|k| !k.trim().is_empty())
}

pub fn save_key(app: &AppIdentity, key: &str) -> anyhow::Result<()> {
    bf_vault::save(app.key_entry, key)
}

/// Forget the app's key here only (the platform already refused it).
pub fn forget_key(app: &AppIdentity) {
    bf_vault::delete(app.key_entry);
}

/// Forget the key here and revoke it on the platform (best effort — offline still signs out).
pub fn sign_out(app: &AppIdentity, key: &str) {
    forget_key(app);
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
