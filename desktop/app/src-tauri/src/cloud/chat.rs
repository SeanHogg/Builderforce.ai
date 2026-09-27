//! The window's chat commands — the workspace's Brain chats, the same conversations the
//! web app and the VS Code extension show (`/api/brain/chats`), and the agents in them.
//!
//! A message addressed to an agent is posted with `addressedTo` metadata and the platform
//! dispatches that agent's reply (it runs with its own tools, as the person). Any other
//! message is for the Brain, which in Synapse answers here with the private Evermind's
//! recall as context ([`super::brain`]).

use super::{brain, Cloud, Res};
use crate::agents::Agents;
use crate::pool::blocking;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;
use tauri::State;

fn api(c: &Cloud, method: &str, path: &str, body: Option<Value>) -> Res<Value> {
    let s = c.require()?;
    s.api(method, path, body).map_err(|e| c.fail(e))
}

#[tauri::command]
pub async fn chat_list(cloud: State<'_, Arc<Cloud>>) -> Res<Value> {
    blocking(cloud, |c| api(c, "GET", "/api/brain/chats?limit=50", None)).await
}

#[tauri::command]
pub async fn chat_create(cloud: State<'_, Arc<Cloud>>, title: Option<String>) -> Res<Value> {
    blocking(cloud, move |c| {
        let title = title.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        api(c, "POST", "/api/brain/chats", Some(json!({ "title": title })))
    })
    .await
}

/// The transcript, and whether the Brain is still writing its reply here.
#[tauri::command]
pub async fn chat_messages(cloud: State<'_, Arc<Cloud>>, chat_id: i64) -> Res<Value> {
    blocking(cloud, move |c| {
        let v = api(c, "GET", &format!("/api/brain/chats/{chat_id}/messages?limit=100"), None)?;
        let replying = c.replying.lock().unwrap().contains(&chat_id);
        let reply_error = c.reply_errors.lock().unwrap().get(&chat_id).cloned();
        Ok(json!({ "messages": v.get("messages").cloned().unwrap_or(json!([])), "replying": replying, "replyError": reply_error }))
    })
    .await
}

#[tauri::command]
pub async fn chat_agents(cloud: State<'_, Arc<Cloud>>, chat_id: i64) -> Res<Value> {
    blocking(cloud, move |c| api(c, "GET", &format!("/api/brain/chats/{chat_id}/agents"), None)).await
}

/// Assign an agent to the chat (`agentKind`: `workforce` or `registered`).
#[tauri::command]
pub async fn chat_invite(cloud: State<'_, Arc<Cloud>>, chat_id: i64, agent_ref: String, agent_kind: String) -> Res<Value> {
    blocking(cloud, move |c| {
        api(c, "POST", &format!("/api/brain/chats/{chat_id}/agents"), Some(json!({ "agentRef": agent_ref, "agentKind": agent_kind })))
    })
    .await
}

#[tauri::command]
pub async fn chat_uninvite(cloud: State<'_, Arc<Cloud>>, chat_id: i64, assignment_id: i64) -> Res<()> {
    blocking(cloud, move |c| api(c, "DELETE", &format!("/api/brain/chats/{chat_id}/agents/{assignment_id}"), None).map(|_| ())).await
}

/// The workspace's agents that can be assigned: its own and purchased workforce agents,
/// and its active registered agents — the pool the extension offers.
#[tauri::command]
pub async fn agent_pool(cloud: State<'_, Arc<Cloud>>) -> Res<Value> {
    blocking(cloud, |c| {
        let s = c.require()?;
        let mut pool: BTreeMap<String, Value> = BTreeMap::new();
        let mut add = |path: &str, kind: &str| -> Res<()> {
            let v = match s.api("GET", path, None) {
                Ok(v) => v,
                Err(bf_cloud::CloudError::KeyRejected) => return Err(c.fail(bf_cloud::CloudError::KeyRejected)),
                // One list missing (a plan without the marketplace) must not hide the others.
                Err(_) => return Ok(()),
            };
            for a in v.as_array().into_iter().flatten() {
                if a.get("isActive").and_then(Value::as_bool) == Some(false) {
                    continue;
                }
                let Some(id) = a.get("id").map(|i| i.to_string().trim_matches('"').to_string()) else { continue };
                let name = a.get("name").and_then(Value::as_str).unwrap_or(&id).to_string();
                pool.insert(id.clone(), json!({ "ref": id, "name": name, "kind": kind }));
            }
            Ok(())
        };
        add("/api/workforce/agents/mine", "workforce")?;
        add("/api/workforce/agents/purchased", "workforce")?;
        add("/api/agents", "registered")?;
        let mut list: Vec<Value> = pool.into_values().collect();
        list.sort_by(|a, b| a["name"].as_str().unwrap_or("").to_lowercase().cmp(&b["name"].as_str().unwrap_or("").to_lowercase()));
        Ok(json!({ "agents": list }))
    })
    .await
}

#[derive(Debug, Deserialize)]
pub struct Recipient {
    #[serde(rename = "ref")]
    pub agent_ref: String,
    pub name: String,
}

/// Post the person's message. To an agent: the platform dispatches its reply. To the
/// Brain: it answers here, in the background — `chat_messages` says while it writes.
#[tauri::command]
pub async fn chat_send(
    cloud: State<'_, Arc<Cloud>>,
    agents: State<'_, Arc<Agents>>,
    chat_id: i64,
    content: String,
    to: Option<Recipient>,
) -> Res<()> {
    let agents = agents.inner().clone();
    let shared = cloud.inner().clone();
    blocking(cloud, move |c| {
        let content = content.trim().to_string();
        if content.is_empty() {
            return Err("empty message".into());
        }
        let metadata = to.as_ref().map(|r| json!({ "addressedTo": { "kind": "agent", "ref": r.agent_ref, "name": r.name } }).to_string());
        let mut message = json!({ "role": "user", "content": content });
        if let Some(m) = metadata {
            message["metadata"] = json!(m);
        }
        api(c, "POST", &format!("/api/brain/chats/{chat_id}/messages"), Some(json!({ "messages": [message] })))?;
        if to.is_none() {
            brain::reply_in_background(shared, chat_id, agents);
        }
        Ok(())
    })
    .await
}
