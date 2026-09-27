//! The window's account commands: who is signed in and to which workspace, signing in
//! through the browser, switching workspace, signing out, and opening the web app.

use super::{Cloud, Res, SignIn};
use bf_cloud::device::{self, DevicePoll};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::pool::blocking;

/// Signed in or not, a sign-in in progress, and the workspace in use. Checking the
/// workspace makes one exchange with the platform (cached for the token's lifetime), so
/// a key revoked elsewhere is noticed here and signs out.
#[tauri::command]
pub async fn account_state(cloud: State<'_, Arc<Cloud>>) -> Res<Value> {
    blocking(cloud, |c| {
        let sign_in = c.sign_in.lock().unwrap().clone();
        let expired = *c.expired.lock().unwrap();
        let Some(s) = c.session() else {
            return Ok(json!({ "signedIn": false, "signIn": sign_in, "expired": expired, "web": bf_cloud::web_base() }));
        };
        let (workspace_id, reachable, error) = match s.who() {
            Ok((id, _)) => (Some(id), true, None),
            Err(bf_cloud::CloudError::KeyRejected) => {
                c.fail(bf_cloud::CloudError::KeyRejected);
                return Ok(json!({ "signedIn": false, "signIn": sign_in, "expired": true, "web": bf_cloud::web_base() }));
            }
            Err(e) => (s.workspace(), false, Some(e.to_string())),
        };
        Ok(json!({
            "signedIn": true,
            "signIn": sign_in,
            "workspaceId": workspace_id,
            "reachable": reachable,
            "error": error,
            "web": bf_cloud::web_base(),
        }))
    })
    .await
}

/// Start a browser sign-in: open `/activate` with the code, then poll until the person
/// approves (or denies, or it expires). Returns at once; `account_state` shows progress.
#[tauri::command]
pub async fn account_sign_in(app: AppHandle, cloud: State<'_, Arc<Cloud>>) -> Res<()> {
    let cloud = cloud.inner().clone();
    let start = tauri::async_runtime::spawn_blocking(device::start).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    let attempt = {
        let mut a = cloud.attempt.lock().unwrap();
        *a += 1;
        *a
    };
    *cloud.sign_in.lock().unwrap() = SignIn::Waiting { user_code: start.user_code.clone(), verification_uri: start.verification_uri_complete.clone() };
    let _ = app.opener().open_url(&start.verification_uri_complete, None::<&str>);

    std::thread::Builder::new()
        .name("synapse-sign-in".into())
        .spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(start.expires_in);
            let mut wait = Duration::from_secs(start.interval.max(1));
            let failed = |c: &Cloud, reason: &str| *c.sign_in.lock().unwrap() = SignIn::Failed { reason: reason.into() };
            while Instant::now() < deadline {
                std::thread::sleep(wait);
                if *cloud.attempt.lock().unwrap() != attempt {
                    return; // cancelled, or a newer sign-in replaced this one
                }
                match device::poll(&start.device_code) {
                    Ok(DevicePoll::Approved { key, .. }) => return cloud.signed_in(key),
                    Ok(DevicePoll::Pending) => {}
                    Ok(DevicePoll::SlowDown) => wait += Duration::from_secs(2),
                    Ok(DevicePoll::Denied) => return failed(&cloud, "denied"),
                    Ok(DevicePoll::Expired) => return failed(&cloud, "expired"),
                    // Offline for a moment: keep waiting until the code itself expires.
                    Err(_) => {}
                }
            }
            failed(&cloud, "expired");
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn account_sign_in_cancel(cloud: State<'_, Arc<Cloud>>) -> Res<()> {
    blocking(cloud, |c| {
        *c.attempt.lock().unwrap() += 1;
        *c.sign_in.lock().unwrap() = SignIn::Idle;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn account_sign_out(cloud: State<'_, Arc<Cloud>>) -> Res<()> {
    blocking(cloud, |c| {
        if let Some(s) = c.session.lock().unwrap().take() {
            bf_cloud::sign_out(s.key());
        }
        c.remember_workspace(None);
        *c.expired.lock().unwrap() = false;
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
    blocking(cloud, move |c| {
        let s = c.require()?;
        s.set_workspace(Some(id));
        c.remember_workspace(Some(id));
        s.who().map(|_| ()).map_err(|e| c.fail(e))
    })
    .await
}

/// Open a page of the web app (`path` starting with `/`) in the browser.
#[tauri::command]
pub fn account_open_web(app: AppHandle, path: String) -> Res<()> {
    if !path.starts_with('/') || path.starts_with("//") {
        return Err("invalid path".into());
    }
    app.opener().open_url(format!("{}{path}", bf_cloud::web_base()), None::<&str>).map_err(|e| e.to_string())
}
