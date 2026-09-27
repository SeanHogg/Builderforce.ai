//! bf-memory — Synapse's client for the Evermind store on this machine.
//!
//! Synapse keeps nothing of Evermind itself. Facts, demonstrations, Train Once skills,
//! runs and the private model all live in `builderforce-memory` — the engine owns the
//! domain, `builderforce-memory-mcp` persists it (`memory.json`, `experience.json`,
//! `episodes/`) and serves it. This crate starts that server as a child process (see
//! [`launch`]) and calls its tools over MCP's stdio transport: newline-delimited JSON-RPC.
//!
//! One child, calls serialised; a child that died is restarted on the next call.

pub mod launch;

use anyhow::{anyhow, bail, Context, Result};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub use launch::LaunchSpec;

/// The MCP protocol revision Synapse speaks.
const PROTOCOL_VERSION: &str = "2025-06-18";
/// First start may download the package through `npx`.
const START_TIMEOUT: Duration = Duration::from_secs(180);
/// An ordinary tool call.
pub const CALL_TIMEOUT: Duration = Duration::from_secs(30);

/// Turns the experience tools on in the server (off for plain coding-agent installs).
const EXPERIENCE_ENV: (&str, &str) = ("BUILDERFORCE_MEMORY_EXPERIENCE", "1");
/// The private model experience trains, when the person has one.
pub const MODEL_ENV: &str = "BUILDERFORCE_MEMORY_MODEL";

struct Connection {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
    next_id: u64,
}

impl Drop for Connection {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub struct MemoryClient {
    spec: LaunchSpec,
    env: Mutex<Vec<(String, String)>>,
    conn: Mutex<Option<Connection>>,
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
        Self { spec, env: Mutex::new(env), conn: Mutex::new(None) }
    }

    /// Point the server at another private model (or none). The running child is replaced
    /// on the next call, since a process's environment is fixed at start.
    pub fn set_model_file(&self, model_file: Option<&str>) {
        *self.env.lock().unwrap_or_else(|p| p.into_inner()) = synapse_env(model_file);
        *self.conn.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }

    /// Another client for the same server, as its own child process — for a long call
    /// (training) that must not hold up everything else.
    pub fn sibling(&self) -> Self {
        Self::with_spec(self.spec.clone(), self.env.lock().unwrap_or_else(|p| p.into_inner()).clone())
    }

    /// Call a tool and return its JSON result (a tool error is an `Err` with its text).
    pub fn call(&self, tool: &str, args: Value) -> Result<Value> {
        self.call_with_timeout(tool, args, CALL_TIMEOUT)
    }

    pub fn call_as<T: DeserializeOwned>(&self, tool: &str, args: Value) -> Result<T> {
        serde_json::from_value(self.call(tool, args)?).with_context(|| format!("{tool}: unexpected result shape"))
    }

    pub fn call_with_timeout(&self, tool: &str, args: Value, timeout: Duration) -> Result<Value> {
        let mut slot = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        // One retry, on a fresh child: the server may have exited since the last call.
        for attempt in 0..2 {
            if slot.is_none() {
                *slot = Some(self.connect()?);
            }
            let conn = slot.as_mut().expect("connected above");
            match request(conn, "tools/call", json!({ "name": tool, "arguments": args }), timeout) {
                Ok(result) => return tool_result(result),
                Err(CallError::Transport(e)) if attempt == 0 => {
                    *slot = None;
                    eprintln!("synapse: memory server restarted after: {e:#}");
                }
                Err(CallError::Transport(e)) | Err(CallError::Rpc(e)) => {
                    if e.downcast_ref::<Timeout>().is_some() {
                        // A child that stopped answering is replaced, not waited on again.
                        *slot = None;
                    }
                    return Err(e);
                }
            }
        }
        unreachable!("the second attempt always returns")
    }

    fn connect(&self) -> Result<Connection> {
        let env = self.env.lock().unwrap_or_else(|p| p.into_inner()).clone();
        let mut cmd = Command::new(&self.spec.command);
        cmd.args(&self.spec.args).envs(env).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().with_context(|| format!("could not start the memory server ({})", self.spec.command))?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow!("memory server has no stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("memory server has no stdout"))?;
        let (tx, lines) = mpsc::channel();
        std::thread::Builder::new().name("synapse-memory-read".into()).spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if tx.send(line).is_err() {
                    break;
                }
            }
        })?;
        let mut conn = Connection { child, stdin, lines, next_id: 1 };
        let init = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "synapse", "version": env!("CARGO_PKG_VERSION") },
        });
        request(&mut conn, "initialize", init, START_TIMEOUT).map_err(CallError::into_inner).context("memory server did not initialise")?;
        send(&mut conn.stdin, &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).map_err(CallError::into_inner)?;
        Ok(conn)
    }
}

#[derive(Debug)]
struct Timeout;
impl std::fmt::Display for Timeout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("the memory server did not answer in time")
    }
}
impl std::error::Error for Timeout {}

enum CallError {
    /// The pipe broke or the child went away — worth one restart.
    Transport(anyhow::Error),
    /// The server answered with an error, or did not answer in time.
    Rpc(anyhow::Error),
}

impl CallError {
    fn into_inner(self) -> anyhow::Error {
        match self {
            CallError::Transport(e) | CallError::Rpc(e) => e,
        }
    }
}

fn send(stdin: &mut ChildStdin, msg: &Value) -> Result<(), CallError> {
    let mut line = serde_json::to_string(msg).map_err(|e| CallError::Rpc(e.into()))?;
    line.push('\n');
    stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush()).map_err(|e| CallError::Transport(e.into()))
}

/// Send one request and wait for the response with its id, skipping notifications.
fn request(conn: &mut Connection, method: &str, params: Value, timeout: Duration) -> Result<Value, CallError> {
    let id = conn.next_id;
    conn.next_id += 1;
    send(&mut conn.stdin, &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
    let deadline = Instant::now() + timeout;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        let line = match conn.lines.recv_timeout(left) {
            Ok(l) => l,
            Err(RecvTimeoutError::Timeout) => return Err(CallError::Rpc(anyhow!(Timeout))),
            Err(RecvTimeoutError::Disconnected) => return Err(CallError::Transport(anyhow!("the memory server exited"))),
        };
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        if msg.get("id").and_then(Value::as_u64) != Some(id) || msg.get("method").is_some() {
            continue;
        }
        if let Some(err) = msg.get("error") {
            let text = err.get("message").and_then(Value::as_str).unwrap_or("error");
            return Err(CallError::Rpc(anyhow!("{method}: {text}")));
        }
        return Ok(msg.get("result").cloned().unwrap_or(Value::Null));
    }
}

/// A `tools/call` result: the text content, parsed as JSON when it is JSON.
fn tool_result(result: Value) -> Result<Value> {
    let text = result
        .get("content")
        .and_then(Value::as_array)
        .and_then(|c| c.iter().find_map(|p| p.get("text").and_then(Value::as_str)))
        .unwrap_or("")
        .to_string();
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        bail!("{text}");
    }
    Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tool_result_is_its_json_text_and_a_tool_error_is_an_err() {
        let ok = json!({ "content": [{ "type": "text", "text": "{\"id\":\"ep\"}" }] });
        assert_eq!(tool_result(ok).unwrap(), json!({ "id": "ep" }));
        let plain = json!({ "content": [{ "type": "text", "text": "Remembered \"k\"." }] });
        assert_eq!(tool_result(plain).unwrap(), json!("Remembered \"k\"."));
        let err = json!({ "content": [{ "type": "text", "text": "No skill \"x\"." }], "isError": true });
        assert_eq!(tool_result(err).unwrap_err().to_string(), "No skill \"x\".");
    }

    #[test]
    fn a_server_that_cannot_start_is_a_clear_error() {
        let c = MemoryClient::with_spec(LaunchSpec { command: "synapse-no-such-memory-server".into(), args: vec![] }, vec![]);
        let e = c.call("experience_info", json!({})).unwrap_err();
        assert!(format!("{e:#}").contains("could not start the memory server"));
    }
}
