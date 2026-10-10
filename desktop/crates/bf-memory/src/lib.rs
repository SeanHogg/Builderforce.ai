//! bf-memory — Synapse's client for the Evermind store on this machine.
//!
//! Synapse keeps nothing of Evermind itself. Facts, demonstrations, Train Once skills,
//! runs and the private model all live in `builderforce-memory` — the engine owns the
//! domain, `builderforce-memory-mcp` persists it (`memory.json`, `experience.json`,
//! `episodes/`) and serves it. This crate finds that server (see [`launch`]) and talks to
//! it through `bf-mcp`'s stdio client, with the environment Synapse needs.

pub mod launch;

use anyhow::Result;
use bf_mcp::McpClient;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::time::Duration;

pub use bf_mcp::LaunchSpec;
pub use bf_mcp::CALL_TIMEOUT;

/// Turns the experience tools on in the server (off for plain coding-agent installs).
const EXPERIENCE_ENV: (&str, &str) = ("BUILDERFORCE_MEMORY_EXPERIENCE", "1");
/// The private model experience trains, when the person has one.
pub const MODEL_ENV: &str = "BUILDERFORCE_MEMORY_MODEL";
const LABEL: &str = "the memory server";

pub struct MemoryClient {
    inner: McpClient,
}

/// The server environment for Synapse: experience on, and the private model if there is one.
fn synapse_env(model_file: Option<&str>) -> Vec<(String, String)> {
    let mut env = vec![(EXPERIENCE_ENV.0.to_string(), EXPERIENCE_ENV.1.to_string())];
    if let Some(m) = model_file.filter(|m| !m.trim().is_empty()) {
        env.push((MODEL_ENV.to_string(), m.to_string()));
    }
    env
}

impl MemoryClient {
    /// A client for the server `launch::resolve()` finds, with experience switched on and
    /// `model_file` (if any) as the private model.
    pub fn new(model_file: Option<&str>) -> Self {
        Self::with_spec(launch::resolve(), synapse_env(model_file))
    }

    pub fn with_spec(spec: LaunchSpec, env: Vec<(String, String)>) -> Self {
        Self { inner: McpClient::new(spec, env, LABEL) }
    }

    /// Point the server at another private model (or none); the child restarts on the next call.
    pub fn set_model_file(&self, model_file: Option<&str>) {
        self.inner.set_env(synapse_env(model_file));
    }

    /// Another client for the same server, as its own child process — for a long call
    /// (training) that must not hold up everything else.
    pub fn sibling(&self) -> Self {
        Self { inner: self.inner.sibling() }
    }

    pub fn call(&self, tool: &str, args: Value) -> Result<Value> {
        self.inner.call(tool, args)
    }

    pub fn call_as<T: DeserializeOwned>(&self, tool: &str, args: Value) -> Result<T> {
        self.inner.call_as(tool, args)
    }

    pub fn call_with_timeout(&self, tool: &str, args: Value, timeout: Duration) -> Result<Value> {
        self.inner.call_with_timeout(tool, args, timeout)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_server_that_cannot_start_is_a_clear_error() {
        let c = MemoryClient::with_spec(LaunchSpec { command: "synapse-no-such-memory-server".into(), args: vec![] }, vec![]);
        let e = c.call("experience_info", json!({})).unwrap_err();
        assert!(format!("{e:#}").contains("could not start the memory server"));
    }

    #[test]
    fn the_model_file_is_passed_only_when_there_is_one() {
        assert_eq!(synapse_env(None).len(), 1);
        assert_eq!(synapse_env(Some("  ")).len(), 1);
        assert_eq!(synapse_env(Some("C:/m.evermind"))[1], (MODEL_ENV.to_string(), "C:/m.evermind".to_string()));
    }
}
