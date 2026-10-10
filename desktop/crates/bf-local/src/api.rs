//! The compatible endpoint: whatever the local runtime serves, on a stable loopback port,
//! in the two wire formats AI tools speak — OpenAI (`/v1/chat/completions`,
//! `/v1/models`) and Anthropic (`/v1/messages`, which Claude Code uses). The runtime
//! already implements both, so this is a guarded pass-through: requests are checked
//! here, then forwarded with their bodies, and responses stream back as they arrive.
//!
//! Guarded like the context service: loopback only, a key (sent as `Authorization:
//! Bearer` or Anthropic's `x-api-key`), and any request carrying a browser `Origin` is
//! refused, so a web page cannot use the person's models even if it guessed the port.

use anyhow::{anyhow, Result};
use rand::RngCore;
use std::io::{Read, Write};
use std::sync::Arc;
use std::time::Duration;
use tiny_http::{Method, Request, Server};

const MAX_BODY_BYTES: u64 = 32 * 1024 * 1024;
/// A long answer from a slow local model.
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// The credential-store entry holding the endpoint's key.
pub const KEY_ENTRY: &str = "local-api:key";
/// Request headers worth forwarding: the body's type and Anthropic's versioning.
const FORWARDED: [&str; 3] = ["Content-Type", "anthropic-version", "anthropic-beta"];

/// The endpoint's key, made on first use and kept in the OS credential store.
pub fn key() -> Result<String> {
    if let Some(k) = bf_vault::load(KEY_ENTRY).filter(|k| !k.is_empty()) {
        return Ok(k);
    }
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    let k = format!("syn-{}", bytes.iter().map(|b| format!("{b:02x}")).collect::<String>());
    bf_vault::save(KEY_ENTRY, &k)?;
    Ok(k)
}

/// A new key; tools configured with the old one stop working.
pub fn rotate_key() -> Result<String> {
    bf_vault::delete(KEY_ENTRY);
    key()
}

pub struct Running {
    pub port: u16,
    server: Arc<Server>,
}

impl Running {
    pub fn stop(&self) {
        self.server.unblock();
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Serve on `127.0.0.1:port` (0 = any free port; [`Running::port`] says which), forwarding
/// to the runtime at `upstream`.
pub fn start(port: u16, key: String, upstream: String) -> Result<Running> {
    let server = Arc::new(Server::http(("127.0.0.1", port)).map_err(|e| anyhow!("port {port} is not available: {e}"))?);
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
    let srv = server.clone();
    std::thread::Builder::new().name("synapse-local-api".into()).spawn(move || {
        for request in srv.incoming_requests() {
            let (key, upstream) = (key.clone(), upstream.clone());
            let _ = std::thread::Builder::new().name("synapse-local-req".into()).spawn(move || handle(request, &key, &upstream));
        }
    })?;
    Ok(Running { port, server })
}

fn header(req: &Request, name: &str) -> Option<String> {
    req.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str().to_string())
}

/// The key a request presents, in either format's header.
fn presented_key(authorization: Option<&str>, x_api_key: Option<&str>) -> Option<String> {
    authorization.and_then(|v| v.strip_prefix("Bearer ")).or(x_api_key).map(|k| k.trim().to_string())
}

/// Only the model API is forwarded — never the runtime's management (`/api/pull`, …).
fn forwardable(path: &str) -> bool {
    path.starts_with("/v1/") && !path.contains("..")
}

fn handle(mut req: Request, key: &str, upstream: &str) {
    if header(&req, "Origin").is_some() {
        return reply(req, 403, "browser origins are not allowed");
    }
    let presented = presented_key(header(&req, "Authorization").as_deref(), header(&req, "x-api-key").as_deref());
    if !presented.is_some_and(|p| constant_time_eq(p.as_bytes(), key.as_bytes())) {
        return reply(req, 401, "missing or invalid key");
    }
    let path = req.url().to_string();
    if !forwardable(&path) {
        return reply(req, 404, "not found");
    }
    let method = req.method().clone();
    let mut call = ureq::request(method.as_str(), &format!("{upstream}{path}")).timeout(UPSTREAM_TIMEOUT);
    for name in FORWARDED {
        if let Some(v) = header(&req, name) {
            call = call.set(name, &v);
        }
    }
    let resp = if method == Method::Get || method == Method::Head {
        call.call()
    } else {
        let mut body = Vec::new();
        if req.as_reader().take(MAX_BODY_BYTES).read_to_end(&mut body).is_err() {
            return reply(req, 400, "unreadable body");
        }
        call.send_bytes(&body)
    };
    let resp = match resp {
        Ok(r) | Err(ureq::Error::Status(_, r)) => r,
        Err(ureq::Error::Transport(t)) => return reply(req, 502, &format!("the local runtime is not answering: {t}")),
    };
    let status = resp.status();
    let content_type = resp.content_type().to_string();
    let _ = stream(req, status, &content_type, resp.into_reader());
}

/// Write the response ourselves, chunk by chunk with a flush each time — a buffered
/// writer would hold a streamed answer back until kilobytes had piled up.
fn stream(req: Request, status: u16, content_type: &str, mut body: impl Read) -> std::io::Result<()> {
    let mut w = req.into_writer();
    write!(w, "HTTP/1.1 {status} {}\r\nContent-Type: {content_type}\r\nCache-Control: no-cache\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n", reason(status))?;
    let mut buf = [0u8; 8192];
    loop {
        let n = body.read(&mut buf)?;
        if n == 0 {
            break;
        }
        write!(w, "{n:x}\r\n")?;
        w.write_all(&buf[..n])?;
        w.write_all(b"\r\n")?;
        w.flush()?;
    }
    w.write_all(b"0\r\n\r\n")?;
    w.flush()
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        _ => "",
    }
}

fn reply(req: Request, status: u16, message: &str) {
    let body = serde_json::json!({ "error": { "type": "synapse_error", "message": message } }).to_string();
    let _ = stream(req, status, "application/json", body.as_bytes());
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn either_header_carries_the_key() {
        assert_eq!(presented_key(Some("Bearer k1"), None).as_deref(), Some("k1"));
        assert_eq!(presented_key(None, Some(" k2 ")).as_deref(), Some("k2"));
        assert_eq!(presented_key(Some("Basic x"), None), None);
        assert_eq!(presented_key(None, None), None);
    }

    #[test]
    fn only_the_model_api_is_forwarded() {
        assert!(forwardable("/v1/chat/completions"));
        assert!(forwardable("/v1/messages?beta=true"));
        assert!(!forwardable("/api/pull"));
        assert!(!forwardable("/v1/../api/delete"));
    }

    /// End to end over loopback, with a fake runtime: the key is required, a browser is
    /// refused, and an answer streams through unchanged.
    #[test]
    fn requests_are_guarded_then_passed_through() {
        let upstream = Server::http("127.0.0.1:0").unwrap();
        let up_port = upstream.server_addr().to_ip().unwrap().port();
        std::thread::spawn(move || {
            for r in upstream.incoming_requests() {
                let echo = format!("{} {}", r.method(), r.url());
                let _ = r.respond(tiny_http::Response::from_string(echo));
            }
        });
        let running = start(0, "secret".into(), format!("http://127.0.0.1:{up_port}")).unwrap();
        let port = running.port;
        let url = format!("http://127.0.0.1:{port}/v1/messages");
        let unauth = ureq::post(&url).send_string("{}");
        assert!(matches!(unauth, Err(ureq::Error::Status(401, _))));
        let browser = ureq::post(&url).set("x-api-key", "secret").set("Origin", "https://evil.example").send_string("{}");
        assert!(matches!(browser, Err(ureq::Error::Status(403, _))));
        let ok = ureq::post(&url).set("x-api-key", "secret").send_string("{}").unwrap().into_string().unwrap();
        assert_eq!(ok, "POST /v1/messages");
        let models = ureq::get(&format!("http://127.0.0.1:{port}/v1/models")).set("Authorization", "Bearer secret").call().unwrap().into_string().unwrap();
        assert_eq!(models, "GET /v1/models");
    }
}
