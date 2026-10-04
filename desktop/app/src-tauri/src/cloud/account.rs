//! The window's account commands: who is signed in and to which workspace, signing in
//! through the browser, switching workspace, signing out, and opening the web app. The
//! state behind them is `bf_cloud::Account`, shared with Spawn.

use super::{Cloud, Res};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::pool::blocking;

/// Signed in or not, a sign-in in progress, and the workspace in use.
#[tauri::command]
pub async fn account_state(cloud: State<'_, Arc<Cloud>>) -> Res<Value> {
    blocking(cloud, |c| Ok(c.account.state())).await
}

/// Start a browser sign-in: open `/activate` with the code, then poll until the person
/// approves (or denies, or it expires). Returns at once; `account_state` shows progress.
#[tauri::command]
pub async fn account_sign_in(app: AppHandle, cloud: State<'_, Arc<Cloud>>) -> Res<()> {
    let account = cloud.account.clone();
    let start = tauri::async_runtime::spawn_blocking(move || account.begin_sign_in())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    let _ = app.opener().open_url(&start.verification_uri_complete, None::<&str>);
    Ok(())
}

#[tauri::command]
pub async fn account_sign_in_cancel(cloud: State<'_, Arc<Cloud>>) -> Res<()> {
    blocking(cloud, |c| {
        c.account.cancel_sign_in();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn account_sign_out(cloud: State<'_, Arc<Cloud>>) -> Res<()> {
    blocking(cloud, |c| {
        c.account.sign_out();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn account_workspaces(cloud: State<'_, Arc<Cloud>>) -> Res<Value> {
    blocking(cloud, |c| {
        let s = c.require()?;
        let list = s.workspaces().map_err(|e| c.fail(e))?;
        Ok(json!({ "workspaces": list, "current": s.who().ok().map(|w| w.0) }))
    })
    .await
}

#[tauri::command]
pub async fn account_select_workspace(cloud: State<'_, Arc<Cloud>>, id: i64) -> Res<()> {
    blocking(cloud, move |c| c.account.select_workspace(id)).await
}

/// Open a page of the web app (`path` starting with `/`) in the browser.
#[tauri::command]
pub fn account_open_web(app: AppHandle, path: String) -> Res<()> {
    if !path.starts_with('/') || path.starts_with("//") {
        return Err("invalid path".into());
    }
    app.opener().open_url(format!("{}{path}", bf_cloud::web_base()), None::<&str>).map_err(|e| e.to_string())
}
