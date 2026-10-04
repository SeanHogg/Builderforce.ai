//! The window's account commands: signing in through the browser under Spawn's own
//! identity, signing out, the Spawn account (age, membership, tokens), and opening the
//! website's account page where membership and tokens are bought.

use crate::{blocking, App, Res, UiError};
use bf_cloud::CloudError;
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

/// A platform failure as the window shows it. A refused key also signs out.
pub fn cloud_error(app: &App, err: CloudError) -> UiError {
    match &err {
        CloudError::SignedOut => UiError::new("signed_out", err.to_string()),
        CloudError::KeyRejected => UiError::new("signed_out", app.account.fail(err)),
        CloudError::Unreachable(_) => UiError::new("offline", err.to_string()),
        CloudError::Status { .. } => UiError::new(err.reason().unwrap_or("server"), err.to_string()),
    }
}

/// Signed in or not, and a sign-in in progress.
#[tauri::command]
pub async fn account_state(app: State<'_, Arc<App>>) -> Res<Value> {
    blocking(app, |a| Ok(a.account.state())).await
}

/// Start a browser sign-in and open its approval page; `account_state` shows progress.
#[tauri::command]
pub async fn account_sign_in(handle: AppHandle, app: State<'_, Arc<App>>) -> Res<()> {
    let account = app.account.clone();
    let start = tauri::async_runtime::spawn_blocking(move || account.begin_sign_in())
        .await
        .map_err(|e| UiError::new("internal", e.to_string()))?
        .map_err(|e| UiError::new("offline", e.to_string()))?;
    let _ = handle.opener().open_url(&start.verification_uri_complete, None::<&str>);
    Ok(())
}

#[tauri::command]
pub async fn account_sign_in_cancel(app: State<'_, Arc<App>>) -> Res<()> {
    blocking(app, |a| {
        a.account.cancel_sign_in();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn account_sign_out(app: State<'_, Arc<App>>) -> Res<()> {
    blocking(app, |a| {
        a.account.sign_out();
        Ok(())
    })
    .await
}

/// The Spawn account: age, membership, token balance and whether a build would start.
#[tauri::command]
pub async fn spawn_account(app: State<'_, Arc<App>>) -> Res<Value> {
    blocking(app, |a| {
        let session = a.account.require().map_err(|m| UiError::new("signed_out", m))?;
        session.api("GET", "/api/spawn/account", None).map_err(|e| cloud_error(a, e))
    })
    .await
}

/// Open a page of the website (`path` starting with `/`) in the browser.
#[tauri::command]
pub fn account_open_web(handle: AppHandle, path: String) -> Res<()> {
    if !path.starts_with('/') || path.starts_with("//") {
        return Err(UiError::new("internal", "invalid path"));
    }
    handle
        .opener()
        .open_url(format!("{}{path}", bf_cloud::web_base()), None::<&str>)
        .map_err(|e| UiError::new("internal", e.to_string()))
}
