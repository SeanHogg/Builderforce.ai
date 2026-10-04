//! The window's view of Roblox Studio: is the plugin connected, which place is open, how
//! many play-test errors are waiting — and a way to put the plugin back if it went missing.

use crate::{blocking, App, Res, UiError};
use bf_roblox::BridgeStatus;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn studio_status(app: State<'_, Arc<App>>) -> Res<BridgeStatus> {
    blocking(app, |a| Ok(a.bridge.status())).await
}

/// Rewrite the plugin into Studio's plugins folder (Studio picks it up on its next start).
#[tauri::command]
pub async fn studio_reinstall_plugin(app: State<'_, Arc<App>>) -> Res<String> {
    blocking(app, |a| {
        bf_roblox::plugin::install(a.bridge.port, &a.bridge.token)
            .map(|path| path.display().to_string())
            .map_err(|e| UiError::new("plugin_install_failed", format!("{e:#}")))
    })
    .await
}
