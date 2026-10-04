//! The Brain's reply in a Synapse chat. The platform answers only messages addressed to an
//! agent; the Brain's own turn is run by the surface the person is in (the web page, the
//! extension host — and here), through the same loop: the model streams its answer and
//! may call the platform's tools (find a ticket, create one, read the board), each run on
//! the platform as the person. What Synapse adds is the person's private Evermind: before
//! answering, it recalls what their tools on this machine have learned about the question,
//! so the answer knows their projects, decisions and preferences — recall stays on the
//! machine except for the few facts relevant to this one question.
//!
//! A tool that only reads runs at once; one that changes something waits for the person's
//! Approve in the transcript ([`super::live`]).

use super::live::LiveReply;
use super::Cloud;
use crate::agents::Agents;
use bf_cloud::llm::ToolCall;
use bf_cloud::tools::PlatformTool;
use bf_cloud::{CloudError, Session};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// How much of the conversation the Brain reads, and how much recall it is given.
const HISTORY: usize = 24;
const RECALL_CHARS: usize = 6000;
/// The platform catalog the Brain is offered: projects, tickets, boards, specs and OKRs,
/// the workspace's connectors and MCP servers — not the platform's own administration.
const SURFACE: &str = "delivery";
/// How much of one tool's result the model reads back.
const RESULT_CHARS: usize = 16_000;
/// Tool calls failing this many times in a row end the tools for this reply: the model
/// answers with what it has instead of retrying forever.
const FAILURE_STREAK: usize = 5;
/// How long a tool that changes something waits for the person before it is declined.
const APPROVAL_WAIT: Duration = Duration::from_secs(5 * 60);
/// The window's event for a reply's progress: `{ chatId, live }`, `live` null once done.
const EVENT: &str = "brain-reply";

const SYSTEM: &str = "You are the Brain in Synapse, the person's Builderforce desktop app. \
Answer directly and concisely. You can see the conversation and, below, what the person's private \
Evermind recalls about the question from their own tools on this machine — use it when it is relevant \
and say so; never invent memories. You have the workspace's platform tools (`builtin_<domain>_<method>`: \
projects, tickets, boards, specs, OKRs, and the workspace's connectors). Resolve names to ids with the \
list/get tools before acting. Read-only tools run at once; a tool that changes something is shown to the \
person to approve, so call it directly when you have the details — if they decline you get `{\"cancelled\": true}`, \
so adjust rather than retry. Never say you did something unless the tool returned success. Code work and \
long-running work belong to an assigned agent: say which one should take it, or suggest assigning one with \
the Agents button, and the person can address it with @.";

/// Start the Brain's reply to `chat_id` unless one is already on its way.
pub fn reply_in_background(app: AppHandle, cloud: Arc<Cloud>, chat_id: i64, agents: Arc<Agents>) {
    if !cloud.replies.begin(chat_id) {
        return;
    }
    let _ = std::thread::Builder::new().name("synapse-brain".into()).spawn(move || {
        let progress = Progress { app, cloud, chat_id };
        let result = reply(&progress, &agents);
        progress.cloud.replies.end(chat_id, result.err());
        let _ = progress.app.emit(EVENT, json!({ "chatId": chat_id, "live": null }));
    });
}

/// The reply in progress, told to the window at each change.
struct Progress {
    app: AppHandle,
    cloud: Arc<Cloud>,
    chat_id: i64,
}

impl Progress {
    fn tell(&self, live: Option<LiveReply>) {
        if let Some(live) = live {
            let _ = self.app.emit(EVENT, json!({ "chatId": self.chat_id, "live": live }));
        }
    }

    fn update(&self, f: impl FnOnce(&mut LiveReply)) {
        self.tell(self.cloud.replies.update(self.chat_id, f));
    }

    fn approve(&self, label: String, arguments: String) -> bool {
        self.cloud.replies.ask(self.chat_id, label, arguments, APPROVAL_WAIT, |live| self.tell(live))
    }
}

fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// A tool's name as a person reads it: `builtin_tasks_create` → `tasks create`.
fn label(name: &str) -> String {
    name.strip_prefix("builtin_").unwrap_or(name).replace('_', " ")
}

/// The conversation so far, as the model reads it; and the person's latest question.
fn conversation(messages: &[Value]) -> (Vec<Value>, String) {
    let mut convo = Vec::new();
    for m in messages.iter().rev().take(HISTORY).rev() {
        let role = m.get("role").and_then(Value::as_str).unwrap_or("");
        let content = m.get("content").and_then(Value::as_str).unwrap_or("").trim();
        if content.is_empty() || !(role == "user" || role == "assistant") {
            continue;
        }
        // Another participant's reply is shown to the Brain as theirs, not its own.
        let author = m
            .get("metadata")
            .and_then(Value::as_str)
            .and_then(|meta| serde_json::from_str::<Value>(meta).ok())
            .and_then(|meta| meta.pointer("/authoredBy/name").and_then(Value::as_str).map(str::to_string));
        let content = match author {
            Some(name) => format!("[{name}] {content}"),
            None => content.to_string(),
        };
        convo.push(json!({ "role": role, "content": content }));
    }
    let question = convo.iter().rev().find(|m| m["role"] == "user").and_then(|m| m["content"].as_str()).unwrap_or("").to_string();
    (convo, question)
}

/// What one tool call answered, for the model; and whether it failed.
enum Outcome {
    Ran(String),
    Declined,
    Failed(String),
}

fn run_tool(s: &Session, tools: &[PlatformTool], call: &ToolCall, progress: &Progress) -> Result<Outcome, CloudError> {
    let Some(tool) = tools.iter().find(|t| t.name == call.name) else {
        return Ok(Outcome::Failed(format!("there is no tool named {}", call.name)));
    };
    let args = if call.arguments.trim().is_empty() { "{}" } else { call.arguments.as_str() };
    let args: Value = match serde_json::from_str(args) {
        Ok(v @ Value::Object(_)) => v,
        _ => return Ok(Outcome::Failed(format!("the arguments for {} are not a JSON object", call.name))),
    };
    if tool.writes() && !progress.approve(label(&tool.name), args.to_string()) {
        return Ok(Outcome::Declined);
    }
    progress.update(|r| r.activity = Some(label(&tool.name)));
    let result = s.call_platform_tool(tool, args);
    progress.update(|r| r.activity = None);
    match result {
        Ok(out) => Ok(Outcome::Ran(out.chars().take(RESULT_CHARS).collect())),
        Err(CloudError::KeyRejected) => Err(CloudError::KeyRejected),
        Err(e) => Ok(Outcome::Failed(e.to_string())),
    }
}

fn reply(progress: &Progress, agents: &Agents) -> Result<(), String> {
    let (cloud, chat_id) = (&progress.cloud, progress.chat_id);
    let s = cloud.require()?;
    let v = s.api("GET", &format!("/api/brain/chats/{chat_id}/messages?limit={HISTORY}"), None).map_err(|e| cloud.fail(e))?;
    let (convo, question) = conversation(v.get("messages").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default());
    if question.is_empty() {
        return Ok(());
    }

    // The private context: what the person's Evermind recalls. Unavailable recall (the
    // store still starting) degrades to an answer without it, never to no answer.
    let recall = agents.mem.call("memory_recall", json!({ "query": question })).map(|v| text(&v)).unwrap_or_default();
    let recall: String = recall.chars().take(RECALL_CHARS).collect();
    let system = if recall.trim().is_empty() {
        format!("{SYSTEM}\n\nEvermind recall: nothing relevant.")
    } else {
        format!("{SYSTEM}\n\nEvermind recall:\n{recall}")
    };
    let mut prompt = vec![json!({ "role": "system", "content": system })];
    prompt.extend(convo);

    // The tools, likewise: an unreachable catalog is an answer without them.
    let tools = match s.platform_tools(SURFACE) {
        Ok(t) => t,
        Err(CloudError::KeyRejected) => return Err(cloud.fail(CloudError::KeyRejected)),
        Err(_) => Vec::new(),
    };
    let mut offered: Vec<Value> = tools.iter().map(PlatformTool::as_function).collect();

    let mut failures = 0;
    loop {
        let mut body = json!({ "messages": prompt });
        if !offered.is_empty() {
            body["tools"] = Value::Array(offered.clone());
        }
        // Each round's text continues the same reply, a paragraph apart.
        let mut first = true;
        let turn = s
            .stream_chat(&body, |piece| {
                progress.update(|r| {
                    if first && !r.draft.is_empty() {
                        r.draft.push_str("\n\n");
                    }
                    r.draft.push_str(piece);
                });
                first = false;
            })
            .map_err(|e| cloud.fail(e))?;
        if turn.tool_calls.is_empty() || offered.is_empty() {
            break;
        }
        let calls: Vec<Value> = turn
            .tool_calls
            .iter()
            .map(|c| json!({ "id": c.id, "type": "function", "function": { "name": c.name, "arguments": c.arguments } }))
            .collect();
        prompt.push(json!({ "role": "assistant", "content": turn.text, "tool_calls": calls }));
        for call in &turn.tool_calls {
            let content = match run_tool(&s, &tools, call, progress).map_err(|e| cloud.fail(e))? {
                Outcome::Ran(out) => {
                    failures = 0;
                    out
                }
                Outcome::Declined => json!({ "cancelled": true, "reason": "the person declined this action" }).to_string(),
                Outcome::Failed(why) => {
                    failures += 1;
                    json!({ "error": why }).to_string()
                }
            };
            prompt.push(json!({ "role": "tool", "tool_call_id": call.id, "content": content }));
        }
        if failures >= FAILURE_STREAK {
            // The next round answers without tools, from what the calls returned.
            offered.clear();
        }
    }

    let answer = cloud.replies.get(chat_id).map(|r| r.draft).unwrap_or_default();
    if answer.trim().is_empty() {
        return Err("the model returned an empty answer".into());
    }
    s.api("POST", &format!("/api/brain/chats/{chat_id}/messages"), Some(json!({ "messages": [{ "role": "assistant", "content": answer.trim() }] })))
        .map_err(|e| cloud.fail(e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tool_reads_as_what_it_does() {
        assert_eq!(label("builtin_tasks_create"), "tasks create");
        assert_eq!(label("acme_send_invoice"), "acme send invoice");
    }

    #[test]
    fn the_conversation_names_other_authors_and_finds_the_question() {
        let messages = vec![
            json!({ "role": "user", "content": "Plan the launch" }),
            json!({ "role": "assistant", "content": "On it", "metadata": "{\"authoredBy\":{\"name\":\"Ada\"}}" }),
            json!({ "role": "tool", "content": "ignored" }),
            json!({ "role": "user", "content": "  What is left?  " }),
        ];
        let (convo, question) = conversation(&messages);
        assert_eq!(convo.len(), 3);
        assert_eq!(convo[1]["content"], "[Ada] On it");
        assert_eq!(question, "What is left?");
    }
}
