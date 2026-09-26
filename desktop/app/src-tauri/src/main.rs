//! Builderforce Desktop — the context service with a window and a tray.
//!
//! The service (bf-context) starts with the app and keeps running while the window is
//! closed; the tray reopens or quits it. Launched as `builderforce-desktop mcp`, the same
//! executable is an MCP stdio server instead (what Claude Code / Cursor are pointed at),
//! and it forwards to the running app's warm index when there is one.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod tray;
mod update;

use bf_context::{api, paths, server, Registry};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{RunEvent, WindowEvent};

struct AppState {
    registry: Arc<Registry>,
}

/// The ONE bridge from the UI to the service: every workspace operation is an `api` op,
/// the same surface the HTTP and MCP transports expose.
#[tauri::command]
async fn call(state: tauri::State<'_, AppState>, op: String, body: Option<Value>) -> Result<Value, String> {
    let reg = state.registry.clone();
    tauri::async_runtime::spawn_blocking(move || api::dispatch(&reg, &op, body.unwrap_or(Value::Null)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectInfo {
    executable: String,
    claude_code: String,
    mcp_json: String,
}

/// How to point Claude Code / Cursor / any MCP client at this machine's index.
#[tauri::command]
fn connect_info() -> Result<ConnectInfo, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?.to_string_lossy().into_owned();
    let mcp_json = serde_json::to_string_pretty(&json!({
        "mcpServers": { "builderforce-context": { "command": exe, "args": ["mcp"] } }
    }))
    .map_err(|e| e.to_string())?;
    Ok(ConnectInfo { claude_code: format!("claude mcp add builderforce-context -- \"{exe}\" mcp"), executable: exe, mcp_json })
}

#[tauri::command]
async fn check_update() -> Result<update::UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(update::check).await.map_err(|e| e.to_string())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("mcp") {
        let root = match args.iter().position(|a| a == "--root") {
            Some(i) => args.get(i + 1).map(Into::into),
            None => std::env::current_dir().ok(),
        };
        let code = match root.map(bf_context::mcp::run_stdio) {
            Some(Ok(())) => 0,
            _ => 1,
        };
        std::process::exit(code);
    }

    let registry = Registry::new(paths::data_dir());
    registry.start_background();
    // Without the loopback server the UI still works; only external clients lose it.
    let running = server::start(registry.clone()).map_err(|e| eprintln!("builderforce-desktop: {e:#}")).ok();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { registry })
        .invoke_handler(tauri::generate_handler![call, connect_info, check_update])
        .setup(|app| {
            tray::install(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides it: the index keeps serving from the tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Builderforce Desktop");

    app.run(move |_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(r) = &running {
                r.stop();
            }
        }
    });
}
