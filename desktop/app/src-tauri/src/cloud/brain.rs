//! The Brain's reply in a Synapse chat. The platform answers only messages addressed to an
//! agent; the Brain's own turn is run by the surface the person is in (the web page, the
//! extension host — and here). What Synapse adds is the person's private Evermind: before
//! answering, it recalls what their tools on this machine have learned about the question,
//! so the answer knows their projects, decisions and preferences — recall stays on the
//! machine except for the few facts relevant to this one question.

use super::Cloud;
use crate::agents::Agents;
use serde_json::{json, Value};
use std::sync::Arc;

/// How much of the conversation the Brain reads, and how much recall it is given.
const HISTORY: usize = 24;
const RECALL_CHARS: usize = 6000;

const SYSTEM: &str = "You are the Brain in Synapse, the person's Builderforce desktop app. \
Answer directly and concisely. You can see the conversation and, below, what the person's private \
Evermind recalls about the question from their own tools on this machine — use it when it is relevant \
and say so; never invent memories. You cannot act on their behalf from here: when the request is work \
(code, tickets, research, anything that needs tools), say which assigned agent should take it, or suggest \
assigning one with the Agents button, and the person can address it with @.";

/// Start the Brain's reply to `chat_id` unless one is already on its way.
pub fn reply_in_background(cloud: Arc<Cloud>, chat_id: i64, agents: Arc<Agents>) {
    if !cloud.replying.lock().unwrap().insert(chat_id) {
        return;
    }
    cloud.reply_errors.lock().unwrap().remove(&chat_id);
    let _ = std::thread::Builder::new().name("synapse-brain".into()).spawn(move || {
        let result = reply(&cloud, chat_id, &agents);
        cloud.replying.lock().unwrap().remove(&chat_id);
        if let Err(e) = result {
            cloud.reply_errors.lock().unwrap().insert(chat_id, e);
        }
    });
}

fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn reply(cloud: &Cloud, chat_id: i64, agents: &Agents) -> Result<(), String> {
    let s = cloud.require()?;
    let v = s.api("GET", &format!("/api/brain/chats/{chat_id}/messages?limit={HISTORY}"), None).map_err(|e| cloud.fail(e))?;
    let messages = v.get("messages").and_then(Value::as_array).cloned().unwrap_or_default();

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

    let answer = s.complete(&Value::Array(prompt), None).map_err(|e| cloud.fail(e))?;
    if answer.trim().is_empty() {
        return Err("the model returned an empty answer".into());
    }
    s.api("POST", &format!("/api/brain/chats/{chat_id}/messages"), Some(json!({ "messages": [{ "role": "assistant", "content": answer }] })))
        .map_err(|e| cloud.fail(e))?;
    Ok(())
}
