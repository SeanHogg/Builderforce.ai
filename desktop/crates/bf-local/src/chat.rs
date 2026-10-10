//! A Brain turn answered by a model on this machine: the runtime's OpenAI-compatible
//! completion, streamed, read by the same reader the gateway's answers go through.

use anyhow::{anyhow, Result};
use bf_cloud::llm::{read_turn, Turn};
use serde_json::{json, Value};
use std::time::Duration;

/// A local model on a laptop CPU can take a while over a long answer.
const TURN_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// Run one turn on `model`. `body` is the completion request (`messages`, and `tools`).
pub fn stream_chat(base: &str, model: &str, body: &Value, on_text: impl FnMut(&str)) -> Result<Turn> {
    let mut body = body.clone();
    body["model"] = json!(model);
    body["stream"] = json!(true);
    let resp = match ureq::post(&format!("{base}/v1/chat/completions")).timeout(TURN_TIMEOUT).send_json(body) {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let text = r.into_string().unwrap_or_default();
            return Err(anyhow!("the local model answered {code}: {}", text.chars().take(300).collect::<String>()));
        }
        Err(ureq::Error::Transport(t)) => return Err(anyhow!("the local runtime is not answering ({t}); is Ollama running?")),
    };
    let whole_json = resp.content_type() == "application/json";
    read_turn(whole_json, resp.into_reader(), on_text).map_err(|e| anyhow!("the local model failed mid-answer: {e}"))
}
