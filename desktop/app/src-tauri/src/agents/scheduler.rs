//! Routines: skills that run on a schedule while Synapse sits in the tray. Every 30 seconds
//! the store is asked which routines are due (`skills_due` — the engine's rule, in the
//! machine's time zone); the first one runs. A routine that comes due while another skill
//! runs waits for the next check. Nothing runs while Self-Directed Agents are switched off.

use super::secrets::values_with_vault;
use super::Agents;
use bf_teach::model::Skill;
use serde::Deserialize;
use serde_json::json;
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

const TICK: Duration = Duration::from_secs(30);

/// A due skill with the routine's values (non-secret parameters).
#[derive(Deserialize)]
struct DueSkill {
    #[serde(flatten)]
    skill: Skill,
    routine: Option<DueRoutine>,
}

#[derive(Deserialize)]
struct DueRoutine {
    #[serde(default)]
    values: BTreeMap<String, String>,
}

pub fn start(agents: Arc<Agents>) {
    let _ = std::thread::Builder::new().name("synapse-scheduler".into()).spawn(move || loop {
        std::thread::sleep(TICK);
        if !agents.settings.enabled() || agents.runs.active().is_some() {
            continue;
        }
        let Ok(due) = agents.mem.call_as::<Vec<DueSkill>>("skills_due", json!({})) else { continue };
        let Some(next) = due.into_iter().next() else { continue };
        let values = values_with_vault(&next.skill, next.routine.map(|r| r.values).unwrap_or_default());
        // `run_start` with trigger "routine" marks the routine as run, so a routine that
        // fails to start is not retried every tick.
        if let Err(e) = agents.runs.start(next.skill, values, "routine") {
            eprintln!("synapse: a routine did not start: {e:#}");
        }
    });
}
