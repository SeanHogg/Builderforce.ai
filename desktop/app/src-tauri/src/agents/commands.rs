//! The window's commands for Self-Directed Agents. Thin: check the opt-in where it applies,
//! call the Evermind store (memory-mcp tools) or the run coordinator, return JSON. Every
//! command runs off the UI thread — a store call is a round trip to the memory server.

use super::secrets::{delete_secrets, save_secrets, saved_secrets, values_with_vault};
use super::{ActiveRecording, Agents};
use base64::Engine;
use bf_teach::model::{new_id, now_ms, Episode, Skill};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;
use tauri::State;

pub(super) type Res<T> = Result<T, String>;

pub(super) fn e(err: impl std::fmt::Display) -> String {
    format!("{err:#}")
}

pub(super) use crate::pool::blocking;

#[tauri::command]
pub async fn agents_state(agents: State<'_, Arc<Agents>>) -> Res<Value> {
    blocking(agents, |a| {
        let s = a.settings.get();
        let rec = a.recording.lock().unwrap();
        let recording = rec.as_ref().map(|r| {
            json!({
                "episodeId": r.episode.id,
                "name": r.episode.name,
                "program": r.episode.program,
                "startedAt": r.episode.started_at,
                "running": r.recording.is_running(),
                "error": r.recording.error(),
                "steps": r.recording.steps(),
            })
        });
        Ok(json!({
            "supported": bf_teach::supported(),
            "enabled": s.enabled,
            "consentedAt": s.consented_at,
            "modelFile": s.model_file,
            "takeoverKey": bf_teach::TAKEOVER_KEY,
            "recording": recording,
            "run": a.runs.active(),
        }))
    })
    .await
}

#[tauri::command]
pub async fn agents_set_enabled(agents: State<'_, Arc<Agents>>, on: bool) -> Res<()> {
    blocking(agents, move |a| {
        if !on {
            // Switching off stops whatever is going — it is the off switch.
            a.runs.stop();
            if let Some(r) = a.recording.lock().unwrap().take() {
                r.recording.stop();
            }
        }
        a.settings
            .update(|s| {
                s.enabled = on;
                if on && s.consented_at.is_none() {
                    s.consented_at = Some(now_ms());
                }
            })
            .map(|_| ())
            .map_err(e)
    })
    .await
}

/// Choose (or clear) the `.evermind` package the agents' experience trains.
#[tauri::command]
pub async fn agents_set_model(agents: State<'_, Arc<Agents>>, path: Option<String>) -> Res<()> {
    blocking(agents, move |a| {
        let path = path.filter(|p| !p.trim().is_empty());
        a.settings.update(|s| s.model_file = path.clone()).map_err(e)?;
        a.mem.set_model_file(path.as_deref());
        Ok(())
    })
    .await
}

// ---- teach ----

#[tauri::command]
pub async fn teach_start(agents: State<'_, Arc<Agents>>, program: String, args: Vec<String>, name: String) -> Res<String> {
    blocking(agents, move |a| {
        a.require_enabled()?;
        let mut slot = a.recording.lock().unwrap();
        if slot.is_some() {
            return Err("a recording is already in progress".into());
        }
        let id = new_id();
        let recording = bf_teach::start_recording(&program, &args, &a.episode_dir(&id).map_err(e)?).map_err(e)?;
        let name = match name.trim() {
            "" => std::path::Path::new(&program).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| program.clone()),
            n => n.to_string(),
        };
        *slot = Some(ActiveRecording {
            recording,
            episode: Episode { id: id.clone(), name, program, args, started_at: now_ms(), ended_at: None, steps: vec![] },
        });
        Ok(id)
    })
    .await
}

/// Stop recording and keep the demonstration in the store (unless nothing was recorded).
#[tauri::command]
pub async fn teach_stop(agents: State<'_, Arc<Agents>>) -> Res<Option<Episode>> {
    blocking(agents, |a| {
        let Some(active) = a.recording.lock().unwrap().take() else { return Ok(None) };
        let mut episode = active.episode;
        episode.steps = active.recording.stop();
        episode.ended_at = Some(now_ms());
        if episode.steps.is_empty() {
            remove_shots(a, &episode.id);
            return Ok(None);
        }
        a.mem.call("episode_save", json!({ "episode": episode })).map_err(e)?;
        Ok(Some(episode))
    })
    .await
}

#[tauri::command]
pub async fn teach_cancel(agents: State<'_, Arc<Agents>>) -> Res<()> {
    blocking(agents, |a| {
        cancel_recording(a);
        Ok(())
    })
    .await
}

/// Stop recording and throw the demonstration away, screenshots included.
pub(super) fn cancel_recording(a: &Agents) {
    if let Some(active) = a.recording.lock().unwrap().take() {
        active.recording.stop();
        remove_shots(a, &active.episode.id);
    }
}

/// Screenshots of a recording that never reached the store (the store removes the rest).
fn remove_shots(a: &Agents, episode_id: &str) {
    if let Ok(dir) = a.episode_dir(episode_id) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[tauri::command]
pub async fn episodes_list(agents: State<'_, Arc<Agents>>) -> Res<Value> {
    blocking(agents, |a| Ok(json!({ "episodes": a.mem.call("episode_list", json!({})).map_err(e)? }))).await
}

#[tauri::command]
pub async fn episode_get(agents: State<'_, Arc<Agents>>, id: String) -> Res<Value> {
    blocking(agents, move |a| a.mem.call("episode_get", json!({ "id": id })).map_err(e)).await
}

#[tauri::command]
pub async fn episode_delete(agents: State<'_, Arc<Agents>>, id: String) -> Res<()> {
    blocking(agents, move |a| a.mem.call("episode_forget", json!({ "id": id })).map(|_| ()).map_err(e)).await
}

/// A step's screenshot as a data URL (the webview cannot read the store's folder).
#[tauri::command]
pub async fn step_image(agents: State<'_, Arc<Agents>>, episode_id: String, file: String) -> Res<Option<String>> {
    blocking(agents, move |a| {
        // Only a bare file name inside the episode's own folder.
        if file.contains(['/', '\\']) || file.contains("..") || episode_id.contains(['/', '\\', '.']) {
            return Err("invalid screenshot name".into());
        }
        let path = a.episode_dir(&episode_id).map_err(e)?.join(file);
        Ok(std::fs::read(path).ok().map(|b| format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(b))))
    })
    .await
}

// ---- skills ----

/// What Train Once would make of a demonstration with these edits, without saving —
/// review shows the engine's own defaults (parameters, approval gates), not a guess.
#[tauri::command]
pub async fn skill_preview(agents: State<'_, Arc<Agents>>, episode_id: String, edits: Value) -> Res<Value> {
    blocking(agents, move |a| a.mem.call("skill_preview", json!({ "episodeId": episode_id, "edits": edits })).map_err(e)).await
}

/// Train Once: compile a reviewed demonstration into a skill.
#[tauri::command]
pub async fn skill_compile(agents: State<'_, Arc<Agents>>, episode_id: String, edits: Value) -> Res<Value> {
    blocking(agents, move |a| a.mem.call("skill_compile", json!({ "episodeId": episode_id, "edits": edits })).map_err(e)).await
}

/// Skills, each with the names of its secrets saved in the OS vault (never their values).
#[tauri::command]
pub async fn skills_list(agents: State<'_, Arc<Agents>>) -> Res<Value> {
    blocking(agents, |a| {
        let raw: Vec<Value> = a.mem.call_as("skill_list", json!({})).map_err(e)?;
        let list: Vec<Value> = raw
            .into_iter()
            .map(|mut v| {
                if let Ok(skill) = serde_json::from_value::<Skill>(v.clone()) {
                    v["savedSecrets"] = json!(saved_secrets(&skill));
                }
                v
            })
            .collect();
        Ok(json!({ "skills": list }))
    })
    .await
}

fn skill(a: &Agents, id: &str) -> Res<Skill> {
    a.mem.call_as("skill_get", json!({ "id": id })).map_err(e)
}

#[tauri::command]
pub async fn skill_delete(agents: State<'_, Arc<Agents>>, id: String) -> Res<()> {
    blocking(agents, move |a| {
        if let Ok(s) = skill(a, &id) {
            delete_secrets(&s);
        }
        a.mem.call("skill_forget", json!({ "id": id })).map(|_| ()).map_err(e)
    })
    .await
}

/// Run a skill now. Secret values the person typed are saved to the OS credential store
/// when `remember_secrets` is set; missing ones come from it.
#[tauri::command]
pub async fn skill_run(agents: State<'_, Arc<Agents>>, id: String, values: BTreeMap<String, String>, remember_secrets: bool) -> Res<String> {
    blocking(agents, move |a| {
        a.require_enabled()?;
        let s = skill(a, &id)?;
        if remember_secrets {
            save_secrets(&s, &values).map_err(e)?;
        }
        let values = values_with_vault(&s, values);
        a.runs.start(s, values, "manual").map_err(e)
    })
    .await
}

/// Give a skill a routine, or remove it (`routine: null`). The routine lives on the skill.
#[tauri::command]
pub async fn skill_schedule(agents: State<'_, Arc<Agents>>, id: String, routine: Value) -> Res<Value> {
    blocking(agents, move |a| {
        if !routine.is_null() {
            a.require_enabled()?;
        }
        a.mem.call("skill_schedule", json!({ "id": id, "routine": routine })).map_err(e)
    })
    .await
}

#[tauri::command]
pub async fn run_stop(agents: State<'_, Arc<Agents>>) -> Res<()> {
    blocking(agents, |a| {
        a.runs.stop();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn run_decide(agents: State<'_, Arc<Agents>>, approve: bool) -> Res<()> {
    blocking(agents, move |a| {
        a.runs.decide(approve);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn runs_list(agents: State<'_, Arc<Agents>>, limit: Option<usize>) -> Res<Value> {
    blocking(agents, move |a| {
        let limit = limit.unwrap_or(50).clamp(1, 500);
        Ok(json!({ "runs": a.mem.call("run_list", json!({ "limit": limit })).map_err(e)? }))
    })
    .await
}

#[tauri::command]
pub async fn run_get(agents: State<'_, Arc<Agents>>, id: String) -> Res<Value> {
    blocking(agents, move |a| {
        let run = a.mem.call("run_get", json!({ "id": id })).map_err(e)?;
        // The skill as it is now, so the audit trail can name each step (null if deleted).
        let skill = run.get("skillId").and_then(Value::as_str).and_then(|sid| a.mem.call("skill_get", json!({ "id": sid })).ok());
        Ok(json!({ "run": run, "skill": skill }))
    })
    .await
}
