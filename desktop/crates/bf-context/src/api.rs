//! The service's operations, transport-free. The loopback HTTP server and the MCP server
//! are both thin adapters over `dispatch`, so a new operation is added once and every
//! client (VS Code, Claude Code, Cursor, the desktop UI) gets it.

use crate::activity::{now_ms, Entry};
use crate::registry::Registry;
use anyhow::{anyhow, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

const DEFAULT_LIMIT: usize = 8;
const DEFAULT_MAP_TOKENS: usize = 1500;
const MAX_MAP_TOKENS: usize = 8000;
const MAX_REFERENCE_TEXTS: usize = 50;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RootReq {
    root: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchReq {
    root: PathBuf,
    query: String,
    limit: Option<usize>,
    path_prefix: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoMapReq {
    root: PathBuf,
    max_tokens: Option<usize>,
    #[serde(default)]
    focus: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefsReq {
    root: PathBuf,
    texts: Vec<String>,
}

/// Operation names — the HTTP path segment (`POST /v1/<op>`) and the MCP tool mapping.
pub mod ops {
    pub const HEALTH: &str = "health";
    pub const WORKSPACES: &str = "workspaces";
    pub const ENSURE: &str = "ensure";
    pub const REMOVE: &str = "remove";
    pub const RESCAN: &str = "rescan";
    pub const STATUS: &str = "status";
    pub const SEARCH: &str = "search";
    pub const REPO_MAP: &str = "repo-map";
    pub const CHECK_REFERENCES: &str = "check-references";
    pub const ACTIVITY: &str = "activity";
}

const ACTIVITY_LIMIT: usize = 100;

/// The operations worth showing a person in "Recent activity" — work a tool asked for.
/// Health probes, listings and the window's own polling are left out.
fn is_tracked(op: &str) -> bool {
    matches!(op, ops::SEARCH | ops::REPO_MAP | ops::CHECK_REFERENCES | ops::ENSURE)
}

/// `dispatch` on behalf of an outside client (`vscode`, `mcp`, …), recorded in the
/// registry's activity log. The desktop window calls `dispatch` directly: its own
/// polling is not activity.
pub fn dispatch_from(reg: &Arc<Registry>, client: &str, op: &str, body: Value) -> Result<Value> {
    if !is_tracked(op) {
        return dispatch(reg, op, body);
    }
    let started = std::time::Instant::now();
    let root = body.get("root").and_then(Value::as_str).map(str::to_owned);
    let detail = describe(op, &body);
    let result = dispatch(reg, op, body);
    reg.activity.record(Entry {
        at: now_ms(),
        client: client.to_string(),
        op: op.to_string(),
        root,
        detail,
        count: result.as_ref().ok().and_then(|v| result_count(op, v)),
        ms: started.elapsed().as_millis() as u64,
        ok: result.is_ok(),
    });
    result
}

fn describe(op: &str, body: &Value) -> Option<String> {
    match op {
        ops::SEARCH => body.get("query").and_then(Value::as_str).map(str::to_owned),
        ops::REPO_MAP => body
            .get("focus")
            .and_then(Value::as_array)
            .filter(|f| !f.is_empty())
            .map(|f| f.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")),
        ops::CHECK_REFERENCES => body.get("texts").and_then(Value::as_array).map(|t| t.len().to_string()),
        _ => None,
    }
}

/// Search → hits returned; memory check → texts found to name missing code.
fn result_count(op: &str, v: &Value) -> Option<usize> {
    let results = v.get("results")?.as_array()?;
    match op {
        ops::SEARCH => Some(results.len()),
        ops::CHECK_REFERENCES => Some(
            results
                .iter()
                .filter(|r| r.get("missing").and_then(Value::as_array).is_some_and(|m| !m.is_empty()))
                .count(),
        ),
        _ => None,
    }
}

pub fn dispatch(reg: &Arc<Registry>, op: &str, body: Value) -> Result<Value> {
    match op {
        ops::HEALTH => Ok(serde_json::to_value(reg.health())?),
        ops::WORKSPACES => Ok(json!({ "workspaces": reg.statuses() })),
        ops::ACTIVITY => Ok(json!({ "entries": reg.activity.recent(ACTIVITY_LIMIT) })),
        ops::ENSURE | ops::STATUS => {
            let r: RootReq = serde_json::from_value(body)?;
            Ok(serde_json::to_value(reg.ensure(&r.root)?.status())?)
        }
        ops::REMOVE => {
            let r: RootReq = serde_json::from_value(body)?;
            Ok(json!({ "removed": reg.remove(&r.root)? }))
        }
        ops::RESCAN => {
            let r: RootReq = serde_json::from_value(body)?;
            reg.rescan(&r.root)?;
            Ok(json!({ "ok": true }))
        }
        ops::SEARCH => {
            let r: SearchReq = serde_json::from_value(body)?;
            if r.query.trim().is_empty() {
                return Err(anyhow!("query is empty"));
            }
            let index = reg.ensure(&r.root)?;
            let results = index.search(&r.query, r.limit.unwrap_or(DEFAULT_LIMIT), r.path_prefix.as_deref())?;
            Ok(json!({ "results": results, "status": index.status() }))
        }
        ops::REPO_MAP => {
            let r: RepoMapReq = serde_json::from_value(body)?;
            let index = reg.ensure(&r.root)?;
            let tokens = r.max_tokens.unwrap_or(DEFAULT_MAP_TOKENS).min(MAX_MAP_TOKENS);
            Ok(json!({ "map": index.repo_map(tokens, &r.focus)?, "status": index.status() }))
        }
        ops::CHECK_REFERENCES => {
            let r: RefsReq = serde_json::from_value(body)?;
            if r.texts.len() > MAX_REFERENCE_TEXTS {
                return Err(anyhow!("at most {MAX_REFERENCE_TEXTS} texts per call"));
            }
            let index = reg.ensure(&r.root)?;
            Ok(json!({ "results": index.check_references(&r.texts)?, "status": index.status() }))
        }
        other => Err(anyhow!("unknown operation '{other}'")),
    }
}
