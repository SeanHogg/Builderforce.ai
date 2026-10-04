//! The loopback bridge between the Spawn app and the Spawn Studio plugin.
//!
//! Roblox Studio plugins can make HTTP requests but cannot accept them, so the plugin
//! LONG-POLLS this server: each `GET /poll` waits until the app has something for it —
//! "send me a picture of the place" or "apply this build" — or until a quiet timeout,
//! then the plugin polls again. Everything the plugin sends back (the picture, a build's
//! result, play-test errors) is a POST.
//!
//! Bound to 127.0.0.1 only, on a port remembered across launches (the plugin file has it
//! baked in). Every request must carry the bridge key from that same file, and requests
//! with a browser `Origin` are refused outright, so a web page cannot drive Studio even if
//! it guessed the port.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tiny_http::{Header, Method, Response, Server};

/// The first port tried; the next few are tried after it if it is taken.
const PREFERRED_PORT: u16 = 34873;
const PORT_ATTEMPTS: u16 = 12;
/// How long a poll waits for work before answering "nothing yet".
const POLL_WAIT: Duration = Duration::from_secs(15);
/// A plugin that has not polled for this long is not connected.
const STALE_AFTER: Duration = Duration::from_secs(25);
const MAX_BODY_BYTES: u64 = 4 * 1024 * 1024;
const MAX_ERRORS: usize = 40;
const TOKEN_HEADER: &str = "X-Spawn-Token";

/// The plugin's picture of the open place.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    #[serde(default)]
    pub tree: String,
    #[serde(default)]
    pub scripts: Vec<Value>,
    #[serde(default)]
    pub place_name: String,
}

/// What the plugin did with a build.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobResult {
    #[serde(default)]
    pub applied: u32,
    #[serde(default)]
    pub failed: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub connected: bool,
    pub place_name: Option<String>,
    pub errors: usize,
    pub plugin_installed: bool,
}

#[derive(Default)]
struct State {
    last_poll: Option<Instant>,
    want_snapshot: bool,
    snapshot: Option<Snapshot>,
    snapshot_seq: u64,
    jobs: VecDeque<Value>,
    results: HashMap<String, JobResult>,
    errors: Vec<String>,
}

struct Shared {
    state: Mutex<State>,
    changed: Condvar,
}

#[derive(Serialize, Deserialize)]
struct BridgeFile {
    port: u16,
    token: String,
}

pub struct Bridge {
    shared: Arc<Shared>,
    server: Arc<Server>,
    pub port: u16,
    pub token: String,
}

impl Bridge {
    /// Bind (on the remembered port when it is free) and serve on a background thread.
    /// The caller installs the plugin with this bridge's `port` and `token`.
    pub fn start(dir: &Path) -> Result<Self> {
        let file = dir.join("bridge.json");
        let saved: Option<BridgeFile> = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok());
        let token = saved.as_ref().map(|s| s.token.clone()).unwrap_or_else(new_token);
        let first = saved.as_ref().map(|s| s.port).unwrap_or(PREFERRED_PORT);

        let candidates = std::iter::once(first).chain((0..PORT_ATTEMPTS).map(|i| PREFERRED_PORT + i));
        let (server, port) = candidates
            .filter_map(|port| Server::http(("127.0.0.1", port)).ok().map(|s| (s, port)))
            .next()
            .ok_or_else(|| anyhow!("no free port for the Studio bridge"))?;
        std::fs::create_dir_all(dir)?;
        std::fs::write(&file, serde_json::to_string_pretty(&BridgeFile { port, token: token.clone() })?)?;

        let shared = Arc::new(Shared { state: Mutex::new(State::default()), changed: Condvar::new() });
        let server = Arc::new(server);
        let (srv, sh, key) = (server.clone(), shared.clone(), token.clone());
        std::thread::Builder::new().name("spawn-bridge".into()).spawn(move || {
            for request in srv.incoming_requests() {
                let (sh, key) = (sh.clone(), key.clone());
                let _ = std::thread::Builder::new().name("spawn-bridge-req".into()).spawn(move || handle(&sh, &key, request));
            }
        })?;
        Ok(Self { shared, server, port, token })
    }

    pub fn stop(&self) {
        self.server.unblock();
    }

    pub fn status(&self) -> BridgeStatus {
        let st = self.shared.state.lock().unwrap();
        BridgeStatus {
            connected: st.last_poll.map(|t| t.elapsed() < STALE_AFTER).unwrap_or(false),
            place_name: st.snapshot.as_ref().map(|s| s.place_name.clone()).filter(|n| !n.is_empty()),
            errors: st.errors.len(),
            plugin_installed: crate::plugin::installed(),
        }
    }

    /// The play-test errors reported since the last build that read them.
    pub fn take_errors(&self) -> Vec<String> {
        std::mem::take(&mut self.shared.state.lock().unwrap().errors)
    }

    /// Ask the plugin for a fresh picture of the place and wait for it.
    pub fn fresh_snapshot(&self, timeout: Duration) -> Result<Snapshot, BridgeError> {
        let deadline = Instant::now() + timeout;
        let mut st = self.shared.state.lock().unwrap();
        let since = st.snapshot_seq;
        st.want_snapshot = true;
        self.shared.changed.notify_all();
        while st.snapshot_seq == since {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                st.want_snapshot = false;
                return Err(BridgeError::StudioNotConnected);
            }
            st = self.shared.changed.wait_timeout(st, left).unwrap().0;
        }
        Ok(st.snapshot.clone().unwrap_or_default())
    }

    /// Hand a build's operations to the plugin and wait for what it did with them.
    pub fn apply(&self, ops: Value, timeout: Duration) -> Result<JobResult, BridgeError> {
        let id = new_token();
        let deadline = Instant::now() + timeout;
        let mut st = self.shared.state.lock().unwrap();
        st.jobs.push_back(json!({ "id": id, "ops": ops }));
        self.shared.changed.notify_all();
        loop {
            if let Some(result) = st.results.remove(&id) {
                return Ok(result);
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                st.jobs.retain(|job| job.get("id").and_then(Value::as_str) != Some(id.as_str()));
                return Err(BridgeError::StudioNotConnected);
            }
            st = self.shared.changed.wait_timeout(st, left).unwrap().0;
        }
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BridgeError {
    /// No plugin answered in time: Studio is closed, or the plugin is not loaded.
    StudioNotConnected,
}

impl std::fmt::Display for BridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Roblox Studio is not connected")
    }
}

impl std::error::Error for BridgeError {}

fn new_token() -> String {
    use rand::Rng;
    let bytes: [u8; 16] = rand::thread_rng().gen();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn header(req: &tiny_http::Request, name: &'static str) -> Option<String> {
    req.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str().to_string())
}

fn respond(req: tiny_http::Request, status: u16, body: Value) {
    let mut res = Response::from_string(body.to_string()).with_status_code(status);
    if let Ok(h) = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]) {
        res.add_header(h);
    }
    let _ = req.respond(res);
}

fn read_json(req: &mut tiny_http::Request) -> Option<Value> {
    let mut text = String::new();
    req.as_reader().take(MAX_BODY_BYTES).read_to_string(&mut text).ok()?;
    serde_json::from_str(&text).ok()
}

fn handle(shared: &Shared, token: &str, mut req: tiny_http::Request) {
    if header(&req, "Origin").is_some() {
        return respond(req, 403, json!({ "error": "browser origins are not allowed" }));
    }
    if header(&req, TOKEN_HEADER).as_deref() != Some(token) {
        return respond(req, 401, json!({ "error": "unknown plugin" }));
    }
    let path = req.url().split('?').next().unwrap_or("").to_string();
    match (req.method(), path.as_str()) {
        (Method::Get, "/poll") => {
            let reply = poll(shared);
            respond(req, 200, reply)
        }
        (Method::Post, "/snapshot") => match read_json(&mut req).and_then(|v| serde_json::from_value::<Snapshot>(v).ok()) {
            Some(snapshot) => {
                let mut st = shared.state.lock().unwrap();
                st.snapshot = Some(snapshot);
                st.snapshot_seq += 1;
                shared.changed.notify_all();
                drop(st);
                respond(req, 200, json!({ "ok": true }))
            }
            None => respond(req, 400, json!({ "error": "unreadable snapshot" })),
        },
        (Method::Post, "/result") => {
            let body = read_json(&mut req).unwrap_or(Value::Null);
            let Some(id) = body.get("jobId").and_then(Value::as_str).map(str::to_string) else {
                return respond(req, 400, json!({ "error": "missing jobId" }));
            };
            let result: JobResult = serde_json::from_value(body).unwrap_or_default();
            let mut st = shared.state.lock().unwrap();
            st.results.insert(id, result);
            shared.changed.notify_all();
            drop(st);
            respond(req, 200, json!({ "ok": true }))
        }
        (Method::Post, "/log") => {
            let body = read_json(&mut req).unwrap_or(Value::Null);
            let lines = body.get("lines").and_then(Value::as_array).cloned().unwrap_or_default();
            let mut st = shared.state.lock().unwrap();
            for line in lines.iter().filter_map(Value::as_str) {
                if st.errors.len() < MAX_ERRORS && !st.errors.iter().any(|e| e == line) {
                    st.errors.push(line.chars().take(600).collect());
                }
            }
            drop(st);
            respond(req, 200, json!({ "ok": true }))
        }
        _ => respond(req, 404, json!({ "error": "not found" })),
    }
}

/// Wait for work (a snapshot request or a build), or answer "nothing" after a while.
fn poll(shared: &Shared) -> Value {
    let deadline = Instant::now() + POLL_WAIT;
    let mut st = shared.state.lock().unwrap();
    st.last_poll = Some(Instant::now());
    loop {
        if st.want_snapshot || !st.jobs.is_empty() {
            let want = std::mem::take(&mut st.want_snapshot);
            let jobs: Vec<Value> = st.jobs.drain(..).collect();
            st.last_poll = Some(Instant::now());
            return json!({ "wantSnapshot": want, "jobs": jobs });
        }
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            st.last_poll = Some(Instant::now());
            return json!({ "wantSnapshot": false, "jobs": [] });
        }
        st = shared.changed.wait_timeout(st, left).unwrap().0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(bridge: &Bridge, method: &str, path: &str, body: Option<Value>) -> Result<Value, u16> {
        let req = ureq::request(method, &format!("http://127.0.0.1:{}{path}", bridge.port)).set(TOKEN_HEADER, &bridge.token);
        let res = match body {
            Some(b) => req.send_json(b),
            None => req.call(),
        };
        match res {
            Ok(r) => Ok(r.into_json().unwrap()),
            Err(ureq::Error::Status(code, _)) => Err(code),
            Err(e) => panic!("{e}"),
        }
    }

    #[test]
    fn refuses_a_caller_without_the_key() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = Bridge::start(dir.path()).unwrap();
        let res = ureq::get(&format!("http://127.0.0.1:{}/poll", bridge.port)).call();
        assert!(matches!(res, Err(ureq::Error::Status(401, _))));
    }

    #[test]
    fn a_snapshot_request_reaches_the_plugin_and_its_answer_comes_back() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = Arc::new(Bridge::start(dir.path()).unwrap());
        let plugin = {
            let bridge = bridge.clone();
            std::thread::spawn(move || {
                let reply = call(&bridge, "GET", "/poll", None).unwrap();
                assert_eq!(reply["wantSnapshot"], json!(true));
                call(&bridge, "POST", "/snapshot", Some(json!({ "tree": "Workspace [Workspace]", "scripts": [], "placeName": "Obby" }))).unwrap();
            })
        };
        let snapshot = bridge.fresh_snapshot(Duration::from_secs(10)).unwrap();
        plugin.join().unwrap();
        assert_eq!(snapshot.place_name, "Obby");
        assert!(bridge.status().connected);
    }

    #[test]
    fn a_build_is_handed_over_and_its_result_returned() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = Arc::new(Bridge::start(dir.path()).unwrap());
        let plugin = {
            let bridge = bridge.clone();
            std::thread::spawn(move || {
                let reply = call(&bridge, "GET", "/poll", None).unwrap();
                let job = &reply["jobs"][0];
                assert_eq!(job["ops"][0]["op"], json!("delete"));
                call(&bridge, "POST", "/result", Some(json!({ "jobId": job["id"], "applied": 1, "failed": [] }))).unwrap();
            })
        };
        let result = bridge.apply(json!([{ "op": "delete", "path": "Workspace/Old" }]), Duration::from_secs(10)).unwrap();
        plugin.join().unwrap();
        assert_eq!(result.applied, 1);
    }

    #[test]
    fn without_a_plugin_a_snapshot_times_out_as_not_connected() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = Bridge::start(dir.path()).unwrap();
        assert_eq!(bridge.fresh_snapshot(Duration::from_millis(200)).unwrap_err(), BridgeError::StudioNotConnected);
    }

    #[test]
    fn play_test_errors_are_collected_once_each_and_taken_by_a_build() {
        let dir = tempfile::tempdir().unwrap();
        let bridge = Bridge::start(dir.path()).unwrap();
        call(&bridge, "POST", "/log", Some(json!({ "lines": ["boom", "boom", "bang"] }))).unwrap();
        assert_eq!(bridge.take_errors(), vec!["boom".to_string(), "bang".to_string()]);
        assert!(bridge.take_errors().is_empty());
    }
}
