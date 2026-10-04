//! Synapse — the context service with a window and a tray.
//!
//! The service (bf-context) starts with the app and keeps running while the window is
//! closed; the tray reopens or quits it. Launched as `synapse mcp`, the same
//! executable is an MCP stdio server instead (what Claude Code / Cursor are pointed at),
//! and it forwards to the running app's warm index when there is one.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agents;
mod cloud;
mod pool;
mod tray;
mod update;

use bf_context::{api, paths, server, Registry};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_notification::NotificationExt;

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
        "mcpServers": { "synapse": { "command": exe, "args": ["mcp"] } }
    }))
    .map_err(|e| e.to_string())?;
    Ok(ConnectInfo { claude_code: format!("claude mcp add synapse -- \"{exe}\" mcp"), executable: exe, mcp_json })
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
    let running = server::start(registry.clone()).map_err(|e| eprintln!("synapse: {e:#}")).ok();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState { registry })
        .invoke_handler(tauri::generate_handler![
            call,
            connect_info,
            check_update,
            agents::commands::agents_state,
            agents::commands::agents_set_enabled,
            agents::commands::teach_start,
            agents::commands::teach_stop,
            agents::commands::teach_cancel,
            agents::commands::episodes_list,
            agents::commands::episode_get,
            agents::commands::episode_delete,
            agents::commands::step_image,
            agents::commands::skill_preview,
            agents::commands::skill_compile,
            agents::commands::skills_list,
            agents::commands::skill_delete,
            agents::commands::skill_run,
            agents::commands::run_stop,
            agents::commands::run_decide,
            agents::commands::runs_list,
            agents::commands::run_get,
            agents::commands::skill_schedule,
            agents::commands::agents_set_model,
            agents::evermind::facts_list,
            agents::evermind::evermind_overview,
            agents::evermind::fact_forget,
            agents::evermind::forget_everything,
            agents::evermind::evermind_train,
            agents::evermind::facts_learnable,
            agents::evermind::facts_compact,
            cloud::account::account_state,
            cloud::account::account_sign_in,
            cloud::account::account_sign_in_cancel,
            cloud::account::account_sign_out,
            cloud::account::account_workspaces,
            cloud::account::account_select_workspace,
            cloud::account::account_open_web,
            cloud::chat::chat_list,
            cloud::chat::chat_create,
            cloud::chat::chat_messages,
            cloud::chat::chat_agents,
            cloud::chat::chat_invite,
            cloud::chat::chat_uninvite,
            cloud::chat::agent_pool,
            cloud::chat::chat_send,
            cloud::chat::chat_tool_decide,
            cloud::request::cloud_request,
        ])
        .setup(|app| {
            tray::install(app.handle())?;
            // A step waiting for approval must be seen: bring the window forward and say so,
            // even when Synapse is in the tray.
            let handle = app.handle().clone();
            // Synapse keeps only its opt-in here; what the agents learn lives in the
            // shared Evermind store (memory-mcp).
            let agents = agents::Agents::start(&paths::data_dir(), move |skill, _run| {
                tray::show_main(&handle);
                let _ = handle.notification().builder().title("Synapse").body(tray::approval_body(skill)).show();
            });
            app.manage(agents);
            // Signed in to builderforce.ai (or not) — resumed from the credential store.
            app.manage(cloud::Cloud::open(&paths::data_dir()));
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
        .expect("failed to build Synapse");

    app.run(move |_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(r) = &running {
                r.stop();
            }
        }
    });
}
