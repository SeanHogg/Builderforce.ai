//! Loopback HTTP transport: `POST /v1/<op>` with a JSON body, `GET /v1/health`.
//!
//! Bound to 127.0.0.1 on a random port and guarded by a per-start bearer token that only
//! the discovery file (readable by this user alone) carries. Requests that arrive with a
//! browser `Origin` are refused outright, so a web page cannot drive the index even if
//! it guessed the port.

use crate::api;
use crate::discovery::{self, Discovery};
use crate::registry::Registry;
use anyhow::Result;
use serde_json::{json, Value};
use std::io::Read;
use std::sync::Arc;
use tiny_http::{Header, Method, Response, Server};

const MAX_BODY_BYTES: u64 = 2 * 1024 * 1024;

pub struct Running {
    pub discovery: Discovery,
    server: Arc<Server>,
}

impl Running {
    /// Stop accepting requests and withdraw the discovery file.
    pub fn stop(&self) {
        self.server.unblock();
        discovery::withdraw(&self.discovery);
    }
}

/// Bind, publish the discovery file and serve on a background thread.
pub fn start(reg: Arc<Registry>) -> Result<Running> {
    let server = Arc::new(Server::http("127.0.0.1:0").map_err(|e| anyhow::anyhow!("bind failed: {e}"))?);
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
    let disc = discovery::publish(port)?;
    let token = disc.token.clone();
    let srv = server.clone();
    std::thread::Builder::new().name("bf-context-http".into()).spawn(move || {
        for request in srv.incoming_requests() {
            let reg = reg.clone();
            let token = token.clone();
            let _ = std::thread::Builder::new().name("bf-context-req".into()).spawn(move || handle(reg, &token, request));
        }
    })?;
    Ok(Running { discovery: disc, server })
}

fn header(req: &tiny_http::Request, name: &'static str) -> Option<String> {
    req.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str().to_string())
}

fn handle(reg: Arc<Registry>, token: &str, mut req: tiny_http::Request) {
    if header(&req, "Origin").is_some() {
        return respond(req, 403, json!({ "error": "browser origins are not allowed" }));
    }
    let authorized = header(&req, "Authorization")
        .and_then(|v| v.strip_prefix("Bearer ").map(str::to_owned))
        .map(|t| constant_time_eq(t.as_bytes(), token.as_bytes()))
        .unwrap_or(false);
    if !authorized {
        return respond(req, 401, json!({ "error": "missing or invalid token" }));
    }
    let Some(op) = req.url().strip_prefix("/v1/").map(|s| s.split('?').next().unwrap_or("").to_string()) else {
        return respond(req, 404, json!({ "error": "not found" }));
    };
    let body: Value = match req.method() {
        Method::Get => Value::Null,
        Method::Post => {
            let mut buf = String::new();
            if req.as_reader().take(MAX_BODY_BYTES).read_to_string(&mut buf).is_err() {
                return respond(req, 400, json!({ "error": "unreadable body" }));
            }
            if buf.trim().is_empty() {
                Value::Null
            } else {
                match serde_json::from_str(&buf) {
                    Ok(v) => v,
                    Err(e) => return respond(req, 400, json!({ "error": format!("invalid JSON: {e}") })),
                }
            }
        }
        _ => return respond(req, 405, json!({ "error": "method not allowed" })),
    };
    match api::dispatch(&reg, &op, body) {
        Ok(v) => respond(req, 200, v),
        Err(e) => respond(req, 400, json!({ "error": format!("{e:#}") })),
    }
}

fn respond(req: tiny_http::Request, status: u16, body: Value) {
    let header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).expect("static header");
    let _ = req.respond(Response::from_string(body.to_string()).with_status_code(status).with_header(header));
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
