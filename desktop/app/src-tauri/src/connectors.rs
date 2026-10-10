//! The window's commands for connectors — MCP servers Synapse hosts so the Brain can use
//! their tools. Thin over `bf_mcp::Host`; every command runs off the UI thread, since
//! reading a server's tools starts it (and a first `npx` start downloads the package).

use crate::pool::blocking;
use bf_mcp::{catalog, Host};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;
use tauri::State;

type Res<T> = Result<T, String>;

fn e(err: impl std::fmt::Display) -> String {
    format!("{err:#}")
}

#[tauri::command]
pub async fn connectors_state(host: State<'_, Arc<Host>>) -> Res<Value> {
    blocking(host, |h| Ok(json!({ "catalog": catalog::CATALOG, "connectors": h.list() }))).await
}

/// Install a catalog connector, then read its tools so the window can show them (or why not).
#[tauri::command]
pub async fn connector_install(host: State<'_, Arc<Host>>, catalog_id: String, values: BTreeMap<String, String>) -> Res<Value> {
    blocking(host, move |h| {
        let c = h.install(&catalog_id, &values).map_err(e)?;
        let _ = h.refresh_tools(&c.id);
        Ok(json!({ "id": c.id }))
    })
    .await
}

#[tauri::command]
pub async fn connector_add(host: State<'_, Arc<Host>>, name: String, command_line: String, env: BTreeMap<String, String>) -> Res<Value> {
    blocking(host, move |h| {
        let c = h.add_custom(&name, &command_line, &env).map_err(e)?;
        let _ = h.refresh_tools(&c.id);
        Ok(json!({ "id": c.id }))
    })
    .await
}

#[tauri::command]
pub async fn connector_remove(host: State<'_, Arc<Host>>, id: String) -> Res<()> {
    blocking(host, move |h| h.remove(&id).map_err(e)).await
}

#[tauri::command]
pub async fn connector_set_enabled(host: State<'_, Arc<Host>>, id: String, on: bool) -> Res<()> {
    blocking(host, move |h| h.set_enabled(&id, on).map_err(e)).await
}

/// Start the connector and read its tools again (the window's Check button).
#[tauri::command]
pub async fn connector_refresh(host: State<'_, Arc<Host>>, id: String) -> Res<()> {
    blocking(host, move |h| h.refresh_tools(&id).map(|_| ()).map_err(e)).await
}
