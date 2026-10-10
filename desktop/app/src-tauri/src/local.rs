//! The window's commands for local models: the runtime's state, the hub (what this machine
//! can run), installing and removing models with progress, which model the Brain answers
//! with, and the compatible endpoint other AI tools use. Thin over `bf_local`.

use crate::pool::blocking;
use bf_local::{api, hub, ollama, Local};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

type Res<T> = Result<T, String>;

/// The window's event for a download: `{ model, status, total, completed, done, error }`.
const PULL_EVENT: &str = "local-pull";

fn e(err: impl std::fmt::Display) -> String {
    format!("{err:#}")
}

#[tauri::command]
pub async fn local_state(local: State<'_, Arc<Local>>) -> Res<Value> {
    blocking(local, |l| {
        let base = l.base();
        let version = ollama::version(&base);
        let installed = match &version {
            Some(_) => ollama::installed(&base).map_err(e)?,
            None => Vec::new(),
        };
        Ok(json!({
            "runtime": { "base": base, "version": version, "downloadUrl": ollama::DOWNLOAD_URL },
            "installed": installed,
            "hub": hub::view(hub::total_memory()),
            "settings": l.settings.get(),
            "api": l.api_state(),
        }))
    })
    .await
}

/// Download a model into the runtime. Progress arrives as `local-pull` events; the call
/// returns when the download has finished (or failed).
#[tauri::command]
pub async fn local_pull(app: AppHandle, local: State<'_, Arc<Local>>, model: String) -> Res<()> {
    blocking(local, move |l| {
        let result = ollama::pull(&l.base(), &model, |p| {
            let _ = app.emit(PULL_EVENT, json!({ "model": model, "status": p.status, "total": p.total, "completed": p.completed, "done": false }));
        });
        let error = result.as_ref().err().map(|err| format!("{err:#}"));
        let _ = app.emit(PULL_EVENT, json!({ "model": model, "done": true, "error": error }));
        result.map_err(e)
    })
    .await
}

#[tauri::command]
pub async fn local_delete(local: State<'_, Arc<Local>>, model: String) -> Res<()> {
    blocking(local, move |l| {
        ollama::delete(&l.base(), &model).map_err(e)?;
        // A removed model can no longer answer the Brain.
        if l.chat_model().as_deref() == Some(model.as_str()) {
            l.update(|s| s.chat_model = None).map_err(e)?;
        }
        Ok(())
    })
    .await
}

/// Answer the Brain with `model` (an installed one), or through the gateway (`None`).
#[tauri::command]
pub async fn local_set_chat_model(local: State<'_, Arc<Local>>, model: Option<String>) -> Res<()> {
    blocking(local, move |l| l.update(|s| s.chat_model = model.filter(|m| !m.trim().is_empty())).map(|_| ()).map_err(e)).await
}

#[tauri::command]
pub async fn local_set_api(local: State<'_, Arc<Local>>, enabled: bool, port: Option<u16>) -> Res<Value> {
    blocking(local, move |l| {
        l.update(|s| {
            s.api_enabled = enabled;
            if let Some(p) = port.filter(|p| *p >= 1024) {
                s.api_port = p;
            }
        })
        .map_err(e)?;
        Ok(json!(l.api_state()))
    })
    .await
}

/// The endpoint's key and how to point tools at it — read when the person asks to see it.
#[tauri::command]
pub async fn local_api_connect(local: State<'_, Arc<Local>>) -> Res<Value> {
    blocking(local, |l| {
        let key = api::key().map_err(e)?;
        let base = format!("http://127.0.0.1:{}", l.settings.get().api_port);
        Ok(json!({
            "key": key,
            "baseUrl": base,
            "openai": format!("OPENAI_BASE_URL={base}/v1\nOPENAI_API_KEY={key}"),
            "claudeCode": format!("ANTHROPIC_BASE_URL={base}\nANTHROPIC_AUTH_TOKEN={key}"),
        }))
    })
    .await
}

#[tauri::command]
pub async fn local_api_rotate_key(local: State<'_, Arc<Local>>) -> Res<()> {
    blocking(local, |l| l.rotate_key().map(|_| ()).map_err(e)).await
}
