//! The service's operations, transport-free. The loopback HTTP server and the MCP server
//! are both thin adapters over `dispatch`, so a new operation is added once and every
//! client (VS Code, Claude Code, Cursor, the desktop UI) gets it.

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
}

pub fn dispatch(reg: &Arc<Registry>, op: &str, body: Value) -> Result<Value> {
    match op {
        ops::HEALTH => Ok(serde_json::to_value(reg.health())?),
        ops::WORKSPACES => Ok(json!({ "workspaces": reg.statuses() })),
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
