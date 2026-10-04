//! One build, end to end: a fresh picture of the open place (and the errors the last
//! play-test printed) goes to `/api/spawn/build`; the operations that come back go to the
//! Studio plugin, which applies them as one undo step and says what it did.
//!
//! The picture is taken BEFORE the platform is asked, so a build never runs (or costs
//! anything) while Studio is closed — the one failure a player hits most.

use crate::account::cloud_error;
use crate::{blocking, App, Res, UiError};
use bf_roblox::{BridgeError, JobResult};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

/// How long the plugin has to send a picture of the place.
const SNAPSHOT_WAIT: Duration = Duration::from_secs(8);
/// A build is one model call; a large place and a long answer take a while.
const BUILD_TIMEOUT: Duration = Duration::from_secs(240);
/// How long the plugin has to apply a build it was just handed.
const APPLY_WAIT: Duration = Duration::from_secs(90);

fn not_connected(_: BridgeError) -> UiError {
    UiError::new("studio_not_connected", "Roblox Studio is not connected")
}

#[tauri::command]
pub async fn build(app: State<'_, Arc<App>>, prompt: String, history: Vec<Value>) -> Res<Value> {
    blocking(app, move |a| run(a, &prompt, history)).await
}

fn run(app: &App, prompt: &str, history: Vec<Value>) -> Res<Value> {
    if prompt.trim().is_empty() {
        return Err(UiError::new("prompt_empty", "Tell Spawn what to build"));
    }
    let session = app.account.require().map_err(|m| UiError::new("signed_out", m))?;
    let place = app.bridge.fresh_snapshot(SNAPSHOT_WAIT).map_err(not_connected)?;
    let errors = app.bridge.take_errors();

    let body = json!({
        "prompt": prompt,
        "history": history,
        "place": { "tree": place.tree, "scripts": place.scripts, "errors": errors },
    });
    let out = session.api_with_timeout("POST", "/api/spawn/build", Some(body), BUILD_TIMEOUT).map_err(|e| cloud_error(app, e))?;

    let ops = out.get("ops").cloned().unwrap_or(Value::Array(vec![]));
    let result = if ops.as_array().is_some_and(|list| !list.is_empty()) {
        // The build was paid for; a plugin that vanished between the picture and now
        // still gets the operations if it comes back within the wait.
        app.bridge.apply(ops, APPLY_WAIT).map_err(|_| UiError::new("studio_lost", "Roblox Studio disconnected before the build was applied"))?
    } else {
        JobResult::default()
    };

    Ok(json!({
        "reply": out.get("reply").cloned().unwrap_or(Value::Null),
        "refused": out.get("refused").cloned().unwrap_or(Value::Bool(false)),
        "next": out.get("next").cloned().unwrap_or(Value::Array(vec![])),
        "tokensUsed": out.get("tokensUsed").cloned().unwrap_or(json!(0)),
        "balance": out.get("balance").cloned().unwrap_or(Value::Null),
        "rejected": out.get("rejected").cloned().unwrap_or(Value::Array(vec![])),
        "applied": result.applied,
        "failed": result.failed,
        "placeName": place.place_name,
        "fixedErrors": errors.len(),
    }))
}
