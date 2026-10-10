//! A client for one MCP server over the stdio transport (newline-delimited JSON-RPC 2.0),
//! started as a child process. One child, calls serialised; a child that died is restarted
//! on the next call, and one that stopped answering is replaced rather than waited on.

use crate::spec::LaunchSpec;
use anyhow::{anyhow, bail, Context, Result};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The MCP protocol revision Synapse speaks.
const PROTOCOL_VERSION: &str = "2025-06-18";
/// First start may download the package through `npx`.
const START_TIMEOUT: Duration = Duration::from_secs(180);
/// An ordinary call.
pub const CALL_TIMEOUT: Duration = Duration::from_secs(30);

/// One tool a server advertises (`tools/list`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    /// The server says the tool only reads (`annotations.readOnlyHint`). Anything else
    /// counts as changing something.
    pub read_only: bool,
}

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

pub struct McpClient {
    spec: LaunchSpec,
    /// What the server is called in errors ("the memory server", "GitHub").
    label: String,
    env: Mutex<Vec<(String, String)>>,
    conn: Mutex<Option<Connection>>,
}

impl McpClient {
    pub fn new(spec: LaunchSpec, env: Vec<(String, String)>, label: impl Into<String>) -> Self {
        Self { spec, label: label.into(), env: Mutex::new(env), conn: Mutex::new(None) }
    }

    /// Replace the server's environment. The running child is replaced on the next call,
    /// since a process's environment is fixed at start.
    pub fn set_env(&self, env: Vec<(String, String)>) {
        *self.env.lock().unwrap_or_else(|p| p.into_inner()) = env;
        self.disconnect();
    }

    /// Stop the child now (it restarts on the next call).
    pub fn disconnect(&self) {
        *self.conn.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }

    /// Another client for the same server, as its own child process — for a long call
    /// that must not hold up everything else.
    pub fn sibling(&self) -> Self {
        Self::new(self.spec.clone(), self.env.lock().unwrap_or_else(|p| p.into_inner()).clone(), self.label.clone())
    }

    /// Call a tool and return its JSON result (a tool error is an `Err` with its text).
    pub fn call(&self, tool: &str, args: Value) -> Result<Value> {
        self.call_with_timeout(tool, args, CALL_TIMEOUT)
    }

    pub fn call_as<T: DeserializeOwned>(&self, tool: &str, args: Value) -> Result<T> {
        serde_json::from_value(self.call(tool, args)?).with_context(|| format!("{tool}: unexpected result shape"))
    }

    pub fn call_with_timeout(&self, tool: &str, args: Value, timeout: Duration) -> Result<Value> {
        tool_result(self.rpc("tools/call", json!({ "name": tool, "arguments": args }), timeout)?)
    }

    /// Every tool the server advertises, following `nextCursor` pages.
    pub fn list_tools(&self) -> Result<Vec<ToolInfo>> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let params = match &cursor {
                Some(c) => json!({ "cursor": c }),
                None => json!({}),
            };
            let page = self.rpc("tools/list", params, CALL_TIMEOUT)?;
            tools.extend(page.get("tools").and_then(Value::as_array).into_iter().flatten().filter_map(tool_info));
            cursor = page.get("nextCursor").and_then(Value::as_str).filter(|c| !c.is_empty()).map(str::to_string);
            if cursor.is_none() {
                return Ok(tools);
            }
        }
    }

    /// One request, with one retry on a fresh child when the pipe broke.
    fn rpc(&self, method: &str, params: Value, timeout: Duration) -> Result<Value> {
        let mut slot = self.conn.lock().unwrap_or_else(|p| p.into_inner());
        for attempt in 0..2 {
            if slot.is_none() {
                *slot = Some(self.connect()?);
            }
            let conn = slot.as_mut().expect("connected above");
            match request(conn, &self.label, method, params.clone(), timeout) {
                Ok(result) => return Ok(result),
                Err(CallError::Transport(e)) if attempt == 0 => {
                    *slot = None;
                    eprintln!("synapse: {} restarted after: {e:#}", self.label);
                }
                Err(CallError::Transport(e)) | Err(CallError::Rpc(e)) => {
                    if e.downcast_ref::<Timeout>().is_some() {
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
        let mut child = cmd.spawn().with_context(|| format!("could not start {} ({})", self.label, self.spec.command))?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow!("{} has no stdin", self.label))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("{} has no stdout", self.label))?;
        let (tx, lines) = mpsc::channel();
        std::thread::Builder::new().name("synapse-mcp-read".into()).spawn(move || {
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
        request(&mut conn, &self.label, "initialize", init, START_TIMEOUT)
            .map_err(CallError::into_inner)
            .with_context(|| format!("{} did not initialise", self.label))?;
        send(&mut conn.stdin, &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).map_err(CallError::into_inner)?;
        Ok(conn)
    }
}

fn tool_info(t: &Value) -> Option<ToolInfo> {
    Some(ToolInfo {
        name: t.get("name")?.as_str()?.to_string(),
        description: t.get("description").and_then(Value::as_str).unwrap_or("").to_string(),
        input_schema: t.get("inputSchema").cloned().unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
        read_only: t.pointer("/annotations/readOnlyHint").and_then(Value::as_bool) == Some(true),
    })
}

#[derive(Debug)]
struct Timeout(String);
impl std::fmt::Display for Timeout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} did not answer in time", self.0)
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
fn request(conn: &mut Connection, label: &str, method: &str, params: Value, timeout: Duration) -> Result<Value, CallError> {
    let id = conn.next_id;
    conn.next_id += 1;
    send(&mut conn.stdin, &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
    let deadline = Instant::now() + timeout;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        let line = match conn.lines.recv_timeout(left) {
            Ok(l) => l,
            Err(RecvTimeoutError::Timeout) => return Err(CallError::Rpc(anyhow!(Timeout(label.to_string())))),
            Err(RecvTimeoutError::Disconnected) => return Err(CallError::Transport(anyhow!("{label} exited"))),
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

/// A `tools/call` result: its text content, parsed as JSON when it is JSON.
pub fn tool_result(result: Value) -> Result<Value> {
    let text = result
        .get("content")
        .and_then(Value::as_array)
        .map(|parts| parts.iter().filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n"))
        .unwrap_or_default();
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
        let parts = json!({ "content": [{ "type": "text", "text": "a" }, { "type": "image" }, { "type": "text", "text": "b" }] });
        assert_eq!(tool_result(parts).unwrap(), json!("a\nb"));
        let err = json!({ "content": [{ "type": "text", "text": "No skill \"x\"." }], "isError": true });
        assert_eq!(tool_result(err).unwrap_err().to_string(), "No skill \"x\".");
    }

    #[test]
    fn a_listed_tool_reads_its_schema_and_read_only_hint() {
        let t = tool_info(&json!({ "name": "search", "annotations": { "readOnlyHint": true } })).unwrap();
        assert!(t.read_only);
        assert_eq!(t.input_schema["type"], "object");
        let w = tool_info(&json!({ "name": "write", "description": "d", "inputSchema": { "type": "object", "required": ["p"] } })).unwrap();
        assert!(!w.read_only);
        assert_eq!(w.input_schema["required"][0], "p");
        assert!(tool_info(&json!({ "description": "nameless" })).is_none());
    }

    #[test]
    fn a_server_that_cannot_start_is_a_clear_error() {
        let c = McpClient::new(LaunchSpec { command: "synapse-no-such-server".into(), args: vec![] }, vec![], "the memory server");
        let e = c.call("experience_info", json!({})).unwrap_err();
        assert!(format!("{e:#}").contains("could not start the memory server"));
    }
}
