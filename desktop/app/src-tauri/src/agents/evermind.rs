//! The window's commands for Evermind itself: what it knows (facts), what experience says
//! about the brain (the overview the brain map draws), learning, and forgetting.

use super::commands::{blocking, cancel_recording, e, Res};
use super::secrets::delete_secrets;
use super::Agents;
use bf_teach::model::Skill;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

/// Adapting a model on the CPU takes a while; it runs on its own server child.
const TRAIN_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Facts the brain draws as knowledge nodes — the most important ones.
const TOP_FACTS: usize = 14;

/// Everything Evermind knows as facts. memory-mcp deliberately has no "list all" tool (it
/// would flood a model's context), so the window reads the shared snapshot directly —
/// read-only; forgetting goes through the store.
fn read_facts(a: &Agents) -> anyhow::Result<(Vec<Value>, std::path::PathBuf)> {
    let file = a.store_info()?.memory_file.clone();
    let facts = std::fs::read_to_string(&file)
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<Value>>(&text).ok())
        .unwrap_or_default();
    Ok((facts, file))
}

#[tauri::command]
pub async fn facts_list(agents: State<'_, Arc<Agents>>) -> Res<Value> {
    blocking(agents, |a| {
        let (facts, file) = read_facts(a).map_err(e)?;
        Ok(json!({ "facts": facts, "file": file }))
    })
    .await
}

/// What the brain map draws: the store's experience overview (regions, learned vs
/// pending, adaptations with their measured loss, days, recent events) and the facts —
/// how many, and the most important. Experience that cannot be read yet (the server
/// still starting) comes back as `null` with the reason, so the facts still show.
#[tauri::command]
pub async fn evermind_overview(agents: State<'_, Arc<Agents>>, days: Option<u32>) -> Res<Value> {
    blocking(agents, move |a| {
        let (experience, experience_error) = match a.mem.call("experience_overview", json!({ "days": days.unwrap_or(30) })) {
            Ok(v) => (v, Value::Null),
            Err(err) => (Value::Null, json!(format!("{err:#}"))),
        };
        let (mut facts, _) = read_facts(a).unwrap_or_default();
        let count = facts.len();
        let importance = |f: &Value| f.get("importance").and_then(Value::as_f64).unwrap_or(0.0);
        facts.sort_by(|x, y| importance(y).total_cmp(&importance(x)));
        let top: Vec<Value> = facts
            .iter()
            .take(TOP_FACTS)
            .map(|f| json!({ "key": f.get("key"), "importance": importance(f) }))
            .collect();
        Ok(json!({
            "experience": experience,
            "experienceError": experience_error,
            "facts": { "count": count, "top": top },
        }))
    })
    .await
}

#[tauri::command]
pub async fn fact_forget(agents: State<'_, Arc<Agents>>, key: String) -> Res<()> {
    blocking(agents, move |a| a.mem.call("memory_forget", json!({ "key": key })).map(|_| ()).map_err(e)).await
}

/// Forget everything the agents learned — demonstrations, screenshots, skills, runs and
/// their vault secrets. Facts and the model stay: other tools share them.
#[tauri::command]
pub async fn forget_everything(agents: State<'_, Arc<Agents>>) -> Res<()> {
    blocking(agents, |a| {
        a.runs.stop();
        cancel_recording(a);
        let skills: Vec<Skill> = a.mem.call_as("skill_list", json!({})).map_err(e)?;
        for s in &skills {
            delete_secrets(s);
        }
        a.mem.call("experience_forget_all", json!({ "confirm": true })).map(|_| ()).map_err(e)
    })
    .await
}

/// Teach the private model what the agents have learned since it last trained
/// (`dry_run`: only count it).
#[tauri::command]
pub async fn evermind_train(agents: State<'_, Arc<Agents>>, dry_run: bool) -> Res<Value> {
    blocking(agents, move |a| {
        // Its own server child: training must not hold up a run's audit trail.
        a.mem.sibling().call_with_timeout("experience_train", json!({ "dryRun": dry_run }), TRAIN_TIMEOUT).map_err(e)
    })
    .await
}
