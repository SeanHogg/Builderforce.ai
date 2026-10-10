//! A streamed chat completion from the LLM gateway (`/llm/v1/chat/completions`), the
//! OpenAI shape every client speaks: text arrives as `delta.content` and is handed to the
//! caller as it comes, tool calls arrive as `delta.tool_calls` fragments stitched by index.
//! A gateway that ignores `stream` and answers with one JSON body is read the same way.

use crate::{CloudError, Session};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read};
use std::time::Duration;

/// One model turn, streamed: the longest a reasoning model with tools takes to finish.
const TURN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    /// The arguments as the model wrote them (a JSON object, as text).
    pub arguments: String,
}

/// What the model said in one turn, and the tools it asked for.
#[derive(Debug, Default)]
pub struct Turn {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub finish_reason: Option<String>,
}

/// The turn as its chunks arrive.
#[derive(Default)]
struct Accumulator {
    text: String,
    calls: BTreeMap<u64, ToolCall>,
    finish_reason: Option<String>,
    done: bool,
}

impl Accumulator {
    /// One line of the event stream. Returns the text it added, if any; `Err` when the
    /// upstream failed after the stream opened.
    fn line(&mut self, line: &str) -> Result<Option<String>, String> {
        let Some(payload) = line.trim().strip_prefix("data:").map(str::trim) else { return Ok(None) };
        if payload == "[DONE]" {
            self.done = true;
            return Ok(None);
        }
        // A malformed chunk is skipped, never shown.
        let Ok(chunk) = serde_json::from_str::<Value>(payload) else { return Ok(None) };
        if let Some(err) = chunk.get("error") {
            let message = err.as_str().or_else(|| err.get("message").and_then(Value::as_str)).unwrap_or("unknown error");
            return Err(message.to_string());
        }
        let choice = chunk.pointer("/choices/0");
        if let Some(reason) = choice.and_then(|c| c.get("finish_reason")).and_then(Value::as_str) {
            self.finish_reason = Some(reason.to_string());
        }
        let delta = choice.and_then(|c| c.get("delta"));
        for (i, d) in delta.and_then(|d| d.get("tool_calls")).and_then(Value::as_array).into_iter().flatten().enumerate() {
            let call = self.calls.entry(d.get("index").and_then(Value::as_u64).unwrap_or(i as u64)).or_default();
            if let Some(id) = d.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                call.id = id.to_string();
            }
            if let Some(name) = d.pointer("/function/name").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                call.name = name.to_string();
            }
            if let Some(args) = d.pointer("/function/arguments").and_then(Value::as_str) {
                call.arguments.push_str(args);
            }
        }
        let text = delta.and_then(|d| d.get("content")).and_then(Value::as_str).unwrap_or("");
        if text.is_empty() {
            return Ok(None);
        }
        self.text.push_str(text);
        Ok(Some(text.to_string()))
    }

    /// A whole (non-streamed) completion body.
    fn message(&mut self, body: &Value) {
        let choice = body.pointer("/choices/0");
        self.finish_reason = choice.and_then(|c| c.get("finish_reason")).and_then(Value::as_str).map(str::to_string);
        self.text = choice.and_then(|c| c.pointer("/message/content")).and_then(Value::as_str).unwrap_or("").to_string();
        for (i, c) in choice.and_then(|c| c.pointer("/message/tool_calls")).and_then(Value::as_array).into_iter().flatten().enumerate() {
            self.calls.insert(
                c.get("index").and_then(Value::as_u64).unwrap_or(i as u64),
                ToolCall {
                    id: c.get("id").and_then(Value::as_str).unwrap_or("").to_string(),
                    name: c.pointer("/function/name").and_then(Value::as_str).unwrap_or("").to_string(),
                    arguments: c.pointer("/function/arguments").and_then(Value::as_str).unwrap_or("").to_string(),
                },
            );
        }
    }

    fn finish(self) -> Turn {
        let tool_calls = self
            .calls
            .into_values()
            .filter(|c| !c.name.is_empty())
            .enumerate()
            // A call the model sent without an id still needs one to be answered by.
            .map(|(i, mut c)| {
                if c.id.is_empty() {
                    c.id = format!("call_{i}");
                }
                c
            })
            .collect();
        Turn { text: self.text, tool_calls, finish_reason: self.finish_reason }
    }
}

fn mid_stream(message: String) -> CloudError {
    CloudError::Status { code: 502, message: format!("the model failed mid-answer: {message}"), reason: Some("stream_failed".into()) }
}

/// Read one turn from an OpenAI-shaped completion response — an event stream, or one
/// JSON body when `whole_json` (a server that ignored `stream`). `on_text` gets each
/// piece of the answer as it arrives. The gateway and a local runtime both answer this
/// way, so every route a Brain turn takes reads its reply here.
pub fn read_turn(whole_json: bool, reader: impl Read, mut on_text: impl FnMut(&str)) -> Result<Turn, String> {
    let mut acc = Accumulator::default();
    if whole_json {
        let whole: Value = serde_json::from_reader(reader).map_err(|e| e.to_string())?;
        acc.message(&whole);
        if !acc.text.is_empty() {
            on_text(&acc.text);
        }
        return Ok(acc.finish());
    }
    for line in BufReader::new(reader).lines() {
        let line = line.map_err(|e| e.to_string())?;
        if let Some(text) = acc.line(&line)? {
            on_text(&text);
        }
        if acc.done {
            break;
        }
    }
    Ok(acc.finish())
}

impl Session {
    /// Run one model turn. `body` is the completion request (`messages`, and `tools` when
    /// the model may call them); the gateway routes the model unless `body.model` pins
    /// one. `on_text` gets each piece of the answer as it arrives.
    pub fn stream_chat(&self, body: &Value, on_text: impl FnMut(&str)) -> Result<Turn, CloudError> {
        let mut body = body.clone();
        body["stream"] = json!(true);
        let resp = self.gateway("POST", "/chat/completions", Some(&body), TURN_TIMEOUT)?;
        let whole_json = resp.content_type() == "application/json";
        read_turn(whole_json, resp.into_reader(), on_text).map_err(mid_stream)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(lines: &[&str]) -> (Turn, String) {
        let mut acc = Accumulator::default();
        let mut shown = String::new();
        for l in lines {
            if let Some(t) = acc.line(l).unwrap() {
                shown.push_str(&t);
            }
        }
        (acc.finish(), shown)
    }

    #[test]
    fn text_arrives_piece_by_piece() {
        let (turn, shown) = feed(&[
            r#"data: {"choices":[{"delta":{"content":"Hel"}}]}"#,
            "",
            r#"data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}"#,
            "data: [DONE]",
        ]);
        assert_eq!(shown, "Hello");
        assert_eq!(turn.text, "Hello");
        assert_eq!(turn.finish_reason.as_deref(), Some("stop"));
        assert!(turn.tool_calls.is_empty());
    }

    #[test]
    fn tool_call_fragments_are_stitched_by_index() {
        let (turn, _) = feed(&[
            r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"builtin_tasks_list","arguments":"{\"pro"}}]}}]}"#,
            r#"data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"builtin_projects_list","arguments":"{}"}}]}}]}"#,
            r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"jectId\":7}"}}]}}]}"#,
            r#"data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#,
        ]);
        assert_eq!(turn.tool_calls.len(), 2);
        assert_eq!(turn.tool_calls[0], ToolCall { id: "c1".into(), name: "builtin_tasks_list".into(), arguments: "{\"projectId\":7}".into() });
        assert_eq!(turn.tool_calls[1].name, "builtin_projects_list");
    }

    #[test]
    fn a_failure_after_the_stream_opened_is_an_error_and_junk_is_skipped() {
        let mut acc = Accumulator::default();
        assert_eq!(acc.line("data: {not json").unwrap(), None);
        assert_eq!(acc.line(": keep-alive").unwrap(), None);
        assert_eq!(acc.line(r#"data: {"error":{"message":"overloaded"}}"#).unwrap_err(), "overloaded");
    }

    #[test]
    fn a_whole_body_reads_like_a_stream() {
        let mut acc = Accumulator::default();
        acc.message(&json!({ "choices": [{ "message": { "content": "", "tool_calls": [{ "function": { "name": "builtin_tasks_create", "arguments": "{}" } }] }, "finish_reason": "tool_calls" }] }));
        let turn = acc.finish();
        assert_eq!(turn.tool_calls[0].id, "call_0");
        assert_eq!(turn.finish_reason.as_deref(), Some("tool_calls"));
    }
}
