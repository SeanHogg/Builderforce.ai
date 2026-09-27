//! One way to reach the operations: the running desktop service over loopback when there
//! is one (its index is already warm and shared), otherwise an in-process registry. The
//! MCP bridge and the CLI both go through this, so neither knows which it got.

use crate::api;
use crate::discovery::{self, Discovery};
use crate::paths;
use crate::registry::Registry;
use crate::server;
use anyhow::{anyhow, Result};
use serde_json::Value;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

pub struct Client {
    /// How this caller appears in the service's activity log (`mcp`, `cli`).
    label: &'static str,
    remote: Option<Discovery>,
    local: OnceLock<Arc<Registry>>,
}

impl Client {
    pub fn connect(label: &'static str) -> Self {
        Self { label, remote: discovery::find_live(), local: OnceLock::new() }
    }

    pub fn is_remote(&self) -> bool {
        self.remote.is_some()
    }

    pub fn call(&self, op: &str, body: Value) -> Result<Value> {
        if let Some(d) = &self.remote {
            match call_remote(d, self.label, op, &body) {
                Ok(v) => return Ok(v),
                // The service answered with an operation error — that IS the answer.
                Err(RemoteError::Api(e)) => return Err(anyhow!(e)),
                // The service went away (app quit): serve in-process from here on.
                Err(RemoteError::Transport) => {}
            }
        }
        let reg = self.local.get_or_init(|| {
            let r = Registry::new(paths::data_dir());
            r.start_background();
            r
        });
        api::dispatch_from(reg, self.label, op, body)
    }
}

enum RemoteError {
    /// The service answered with an operation error — that message IS the answer.
    Api(String),
    /// The service did not answer (quit, crashed): the caller falls back in-process, so
    /// why it failed is not needed.
    Transport,
}

fn call_remote(d: &Discovery, label: &str, op: &str, body: &Value) -> Result<Value, RemoteError> {
    let res = ureq::post(&format!("http://127.0.0.1:{}/v1/{op}", d.port))
        .set("Authorization", &format!("Bearer {}", d.token))
        .set(server::CLIENT_HEADER, label)
        .timeout(Duration::from_secs(30))
        .send_json(body.clone());
    match res {
        Ok(r) => r.into_json::<Value>().map_err(|_| RemoteError::Transport),
        Err(ureq::Error::Status(_, r)) => {
            let v: Value = r.into_json().unwrap_or(Value::Null);
            Err(RemoteError::Api(v.get("error").and_then(Value::as_str).unwrap_or("request failed").to_string()))
        }
        Err(_) => Err(RemoteError::Transport),
    }
}
