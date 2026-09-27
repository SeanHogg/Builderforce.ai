//! Synapse's own switches for Self-Directed Agents — the opt-in and where the person's
//! private model is. Everything the agents learn lives in the Evermind store (memory-mcp);
//! this is only whether Synapse may record, run and schedule, which is a choice about this
//! app, not a fact Evermind knows.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentSettings {
    pub enabled: bool,
    /// When the person first switched it on (epoch ms) — the record of consent.
    pub consented_at: Option<i64>,
    /// A `.evermind` package to train with what the agents learn. None = no training.
    pub model_file: Option<String>,
}

pub struct Settings {
    file: PathBuf,
    current: Mutex<AgentSettings>,
}

impl Settings {
    /// Read `agents.json` in `dir`; a missing or unreadable file is "switched off".
    pub fn open(dir: &std::path::Path) -> Self {
        let file = dir.join("agents.json");
        let current = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        Self { file, current: Mutex::new(current) }
    }

    pub fn get(&self) -> AgentSettings {
        self.current.lock().unwrap().clone()
    }

    pub fn enabled(&self) -> bool {
        self.current.lock().unwrap().enabled
    }

    pub fn update(&self, change: impl FnOnce(&mut AgentSettings)) -> Result<AgentSettings> {
        let mut cur = self.current.lock().unwrap();
        let mut next = cur.clone();
        change(&mut next);
        if let Some(dir) = self.file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&self.file, serde_json::to_string_pretty(&next)?)?;
        *cur = next.clone();
        Ok(next)
    }
}
