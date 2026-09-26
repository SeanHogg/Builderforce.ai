//! MCP server over stdio (newline-delimited JSON-RPC 2.0) — how Claude Code, Cursor and
//! any other MCP client get the same index the VS Code extension uses.
//!
//! Tools are a thin mapping onto `api` operations through `Client`, which prefers the
//! running desktop service (warm, shared index) and falls back to in-process.

use crate::api::ops;
use crate::client::Client;
use anyhow::Result;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;

const PROTOCOL_VERSION: &str = "2025-06-18";

pub fn run_stdio(root: PathBuf) -> Result<()> {
    let client = Client::connect();
    // Start indexing now so the first tool call does not pay for the whole scan.
    let _ = client.call(ops::ENSURE, json!({ "root": root }));
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            write_msg(&mut stdout, &error_response(Value::Null, -32700, "parse error"))?;
            continue;
        };
        if let Some(resp) = handle(&client, &root, &msg) {
            write_msg(&mut stdout, &resp)?;
        }
    }
    Ok(())
}

fn write_msg(out: &mut impl Write, v: &Value) -> Result<()> {
    writeln!(out, "{v}")?;
    out.flush()?;
    Ok(())
}

/// `None` for notifications (no `id`), which get no response.
fn handle(client: &Client, root: &PathBuf, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned()?;
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    let result: Result<Value, String> = match method {
        "initialize" => Ok(json!({
            "protocolVersion": params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL_VERSION),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "builderforce-context", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Local code index for this repository. Call repo_map once to see the codebase's shape, semantic_search to find code by meaning or name, and check_references to test whether names in a note or memory still exist."
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_list() })),
        "tools/call" => Ok(call_tool(client, root, &params)),
        _ => return Some(error_response(id, -32601, &format!("method not found: {method}"))),
    };
    Some(match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err(e) => error_response(id, -32603, &e),
    })
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn tool_list() -> Value {
    json!([
        {
            "name": "semantic_search",
            "description": "Find code in this repository by meaning or by name — ranks whole functions/classes by keyword match, identifier parts (resolveMembership matches 'membership') and local embeddings. Use it for 'where is X handled / how does Y work' before grepping or reading files.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "What you are looking for, in words or identifiers." },
                    "limit": { "type": "number", "description": "Max results (default 8, max 25)." },
                    "pathPrefix": { "type": "string", "description": "Only search under this repo-relative path." }
                },
                "required": ["query"]
            }
        },
        {
            "name": "repo_map",
            "description": "The repository's shape in a token budget: files ordered by how much the rest of the code depends on them, each with its most-referenced definitions and their signature lines.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "maxTokens": { "type": "number", "description": "Budget (default 1500, max 8000)." },
                    "focus": { "type": "array", "items": { "type": "string" }, "description": "Repo-relative paths to rank first." }
                }
            }
        },
        {
            "name": "check_references",
            "description": "Check whether the code paths and symbols named in notes or memories still exist in this repository. Returns, per text, the references that are missing — a memory naming a deleted function is stale.",
            "inputSchema": {
                "type": "object",
                "properties": { "texts": { "type": "array", "items": { "type": "string" } } },
                "required": ["texts"]
            }
        },
        {
            "name": "index_status",
            "description": "Indexing progress for this repository: files, chunks, embedded chunks and phase.",
            "inputSchema": { "type": "object", "properties": {} }
        }
    ])
}

fn call_tool(client: &Client, root: &PathBuf, params: &Value) -> Value {
    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
    let mut args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    if !args.is_object() {
        args = json!({});
    }
    args["root"] = json!(root);
    let op = match name {
        "semantic_search" => ops::SEARCH,
        "repo_map" => ops::REPO_MAP,
        "check_references" => ops::CHECK_REFERENCES,
        "index_status" => ops::STATUS,
        _ => return tool_error(&format!("unknown tool '{name}'")),
    };
    match client.call(op, args) {
        Ok(v) => {
            // The map is prose for the model; everything else is structured JSON.
            let text = match (name, v.get("map").and_then(Value::as_str)) {
                ("repo_map", Some(map)) => map.to_string(),
                _ => serde_json::to_string_pretty(&v).unwrap_or_default(),
            };
            json!({ "content": [{ "type": "text", "text": text }], "isError": false })
        }
        Err(e) => tool_error(&format!("{e:#}")),
    }
}

fn tool_error(msg: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": msg }], "isError": true })
}
