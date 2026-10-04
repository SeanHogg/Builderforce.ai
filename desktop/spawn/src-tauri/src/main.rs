//! Spawn — build Roblox games by talking.
//!
//! One window and one background service. The service is the Studio bridge
//! (`bf-roblox`): on start it binds its loopback port and (re)writes the Spawn plugin into
//! Studio's plugins folder with that port and key, so opening Studio is all the setup a
//! player does. The window signs in to builderforce.ai (`bf-cloud`'s shared account,
//! under Spawn's own identity) and sends builds: a picture of the place goes up to
//! `/api/spawn/build`, and the operations that come back go down to the plugin.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod account;
mod build;
mod studio;

use bf_cloud::Account;
use bf_roblox::Bridge;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Manager, RunEvent};

pub struct App {
    pub account: Arc<Account>,
    pub bridge: Bridge,
}

/// A refusal the window shows in the player's language: a stable `code` it has a
/// sentence for (`studio_not_connected`, `membership_required`, …), and the English
/// detail for anything it does not.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiError {
    pub code: String,
    pub message: String,
}

impl UiError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }
}

pub type Res<T> = Result<T, UiError>;

/// Run `f` on the blocking pool: every command is a round trip to the platform or a wait
/// on Studio, and neither may freeze the window.
pub async fn blocking<T: Send + 'static>(app: tauri::State<'_, Arc<App>>, f: impl FnOnce(&App) -> Res<T> + Send + 'static) -> Res<T> {
    let app = app.inner().clone();
    tauri::async_runtime::spawn_blocking(move || f(&app))
        .await
        .map_err(|e| UiError::new("internal", e.to_string()))?
}

/// `~/.builderforce/spawn`, or `SPAWN_HOME`.
fn data_dir() -> PathBuf {
    std::env::var_os("SPAWN_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".builderforce").join("spawn")))
        .unwrap_or_else(|| PathBuf::from(".spawn"))
}

fn main() {
    let dir = data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let bridge = Bridge::start(&dir).expect("Spawn could not open its Studio bridge");
    // Without the plugin the bridge has nobody to talk to; the window says so and offers
    // to try again, so a failure here is reported rather than fatal.
    if let Err(e) = bf_roblox::plugin::install(bridge.port, &bridge.token) {
        eprintln!("spawn: {e:#}");
    }
    let app_state = Arc::new(App { account: Account::open(bf_cloud::SPAWN, &dir), bridge });

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(app_state.clone())
        .invoke_handler(tauri::generate_handler![
            account::account_state,
            account::account_sign_in,
            account::account_sign_in_cancel,
            account::account_sign_out,
            account::account_open_web,
            account::spawn_account,
            studio::studio_status,
            studio::studio_reinstall_plugin,
            build::build,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Spawn");

    app.run(move |_handle, event| {
        if let RunEvent::Exit = event {
            app_state.bridge.stop();
        }
    });
}
