//! The local runtime Synapse manages: Ollama. Synapse does not bundle an inference
//! engine — Ollama already does GPU detection, quantized weights and serving on every
//! OS — it finds the runtime, installs and removes models in it, and routes to it.
//!
//! Address: `OLLAMA_HOST` when set (as Ollama itself reads it), else `127.0.0.1:11434`.

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::time::Duration;

const DEFAULT_HOST: &str = "127.0.0.1:11434";
const PROBE_TIMEOUT: Duration = Duration::from_millis(1200);
const CALL_TIMEOUT: Duration = Duration::from_secs(30);
/// A pull streams for as long as the download takes; this bounds one silent gap.
const PULL_TIMEOUT: Duration = Duration::from_secs(6 * 60 * 60);
pub const DOWNLOAD_URL: &str = "https://ollama.com/download";

/// The runtime's base URL, from an `OLLAMA_HOST`-style value.
pub fn base_from(host: Option<&str>) -> String {
    let raw = host.map(str::trim).filter(|h| !h.is_empty()).unwrap_or(DEFAULT_HOST);
    let with_scheme = if raw.contains("://") { raw.to_string() } else { format!("http://{raw}") };
    // A server bound to every interface is reached on loopback.
    with_scheme.replace("://0.0.0.0", "://127.0.0.1").trim_end_matches('/').to_string()
}

pub fn base() -> String {
    base_from(std::env::var("OLLAMA_HOST").ok().as_deref())
}

/// A model installed in the runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub name: String,
    pub size: u64,
    pub parameter_size: Option<String>,
    pub quantization: Option<String>,
}

/// The runtime's version, or `None` when nothing answers.
pub fn version(base: &str) -> Option<String> {
    let v: Value = ureq::get(&format!("{base}/api/version")).timeout(PROBE_TIMEOUT).call().ok()?.into_json().ok()?;
    v.get("version").and_then(Value::as_str).map(str::to_string)
}

pub fn installed(base: &str) -> Result<Vec<Installed>> {
    let v: Value = ureq::get(&format!("{base}/api/tags")).timeout(CALL_TIMEOUT).call()?.into_json()?;
    Ok(parse_tags(&v))
}

fn parse_tags(v: &Value) -> Vec<Installed> {
    v.get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|m| {
            Some(Installed {
                name: m.get("name").or_else(|| m.get("model"))?.as_str()?.to_string(),
                size: m.get("size").and_then(Value::as_u64).unwrap_or(0),
                parameter_size: m.pointer("/details/parameter_size").and_then(Value::as_str).map(str::to_string),
                quantization: m.pointer("/details/quantization_level").and_then(Value::as_str).map(str::to_string),
            })
        })
        .collect()
}

/// Progress of a pull, as the runtime reports it.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullProgress {
    pub status: String,
    pub total: Option<u64>,
    pub completed: Option<u64>,
}

/// One line of the pull stream: progress, or the runtime's error.
fn pull_line(line: &str) -> Result<Option<PullProgress>> {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return Ok(None) };
    if let Some(e) = v.get("error").and_then(Value::as_str) {
        bail!("{e}");
    }
    Ok(Some(PullProgress {
        status: v.get("status").and_then(Value::as_str).unwrap_or("").to_string(),
        total: v.get("total").and_then(Value::as_u64),
        completed: v.get("completed").and_then(Value::as_u64),
    }))
}

/// Download `model` into the runtime, telling `on_progress` as it goes.
pub fn pull(base: &str, model: &str, mut on_progress: impl FnMut(&PullProgress)) -> Result<()> {
    let resp = ureq::post(&format!("{base}/api/pull")).timeout(PULL_TIMEOUT).send_json(json!({ "model": model, "stream": true }))?;
    let mut last = None;
    for line in BufReader::new(resp.into_reader()).lines() {
        if let Some(p) = pull_line(&line?)? {
            on_progress(&p);
            last = Some(p.status);
        }
    }
    match last.as_deref() {
        Some("success") => Ok(()),
        other => Err(anyhow!("the download of {model} ended without finishing ({})", other.unwrap_or("no progress"))),
    }
}

pub fn delete(base: &str, model: &str) -> Result<()> {
    ureq::request("DELETE", &format!("{base}/api/delete")).timeout(CALL_TIMEOUT).send_json(json!({ "model": model }))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_host_reads_like_ollama_reads_it() {
        assert_eq!(base_from(None), "http://127.0.0.1:11434");
        assert_eq!(base_from(Some("0.0.0.0:11500")), "http://127.0.0.1:11500");
        assert_eq!(base_from(Some("https://box.lan:443/")), "https://box.lan:443");
    }

    #[test]
    fn installed_models_and_pull_lines_parse() {
        let tags = json!({ "models": [{ "name": "qwen2.5:7b-instruct-q4_K_M", "size": 4683087332u64, "details": { "parameter_size": "7.6B", "quantization_level": "Q4_K_M" } }, { "nope": 1 }] });
        let got = parse_tags(&tags);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].quantization.as_deref(), Some("Q4_K_M"));
        assert_eq!(pull_line(r#"{"status":"downloading","total":10,"completed":4}"#).unwrap().unwrap().completed, Some(4));
        assert!(pull_line(r#"{"error":"pull model manifest: file does not exist"}"#).is_err());
        assert_eq!(pull_line("not json").unwrap(), None);
    }
}
