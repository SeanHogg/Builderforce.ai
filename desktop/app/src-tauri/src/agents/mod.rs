//! Self-Directed Agents: teach a task once, let Synapse do it again.
//!
//! Opt-in end to end — nothing records, runs or schedules until the person switches it on
//! ([`Settings`]). Synapse keeps none of what the agents learn: demonstrations, Train Once
//! skills, runs and the private model all live in the Evermind store, reached through
//! [`bf_memory::MemoryClient`] (the same memory-mcp server every AI tool on the machine
//! shares). Recording and replay are `bf-teach`. This module holds only the live state
//! between them and the window — the one recording, the one run — and the scheduler.

pub mod commands;
mod runs;
mod scheduler;
mod secrets;
mod settings;

use bf_memory::MemoryClient;
use bf_teach::model::Episode;
use serde::Deserialize;
use serde_json::json;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

pub use runs::Runs;
pub use settings::Settings;

pub struct ActiveRecording {
    pub recording: bf_teach::Recording,
    pub episode: Episode,
}

/// Where the store keeps things, as the server reports it (`experience_info`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreInfo {
    pub memory_file: PathBuf,
    pub episodes_dir: PathBuf,
}

pub struct Agents {
    pub mem: Arc<MemoryClient>,
    pub settings: Settings,
    pub runs: Arc<Runs>,
    pub recording: Mutex<Option<ActiveRecording>>,
    info: OnceLock<StoreInfo>,
}

impl Agents {
    /// Read the opt-in, connect to the store, and start the scheduler. The server itself
    /// starts on first use, so a slow first `npx` never holds up the window.
    pub fn start(dir: &std::path::Path, on_approval: impl Fn(&str, &str) + Send + Sync + 'static) -> Arc<Self> {
        let settings = Settings::open(dir);
        let mem = Arc::new(MemoryClient::new(settings.get().model_file.as_deref()));
        let runs = Runs::new(mem.clone(), on_approval);
        let agents = Arc::new(Self { mem, settings, runs, recording: Mutex::new(None), info: OnceLock::new() });
        let boot = agents.clone();
        let _ = std::thread::Builder::new().name("synapse-agents-boot".into()).spawn(move || {
            if boot.settings.enabled() {
                boot.runs.close_orphaned();
            }
            scheduler::start(boot);
        });
        agents
    }

    pub fn require_enabled(&self) -> Result<(), String> {
        if self.settings.enabled() {
            Ok(())
        } else {
            Err("Self-Directed Agents are switched off".into())
        }
    }

    /// Where the store keeps memories and screenshots. Asked once, then remembered.
    pub fn store_info(&self) -> anyhow::Result<&StoreInfo> {
        if let Some(i) = self.info.get() {
            return Ok(i);
        }
        let info: StoreInfo = self.mem.call_as("experience_info", json!({}))?;
        Ok(self.info.get_or_init(|| info))
    }

    /// An episode's screenshot folder — `<episodesDir>/<id>`, which the store deletes with it.
    pub fn episode_dir(&self, episode_id: &str) -> anyhow::Result<PathBuf> {
        Ok(self.store_info()?.episodes_dir.join(episode_id))
    }
}
