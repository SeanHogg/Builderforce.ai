//! bf-local — models on the person's own machine.
//!
//! Synapse manages a local runtime rather than bundling one: [`ollama`] finds it, installs
//! and removes models in it; [`hub`] says which models and quantizations this machine can
//! run; [`chat`] answers a Brain turn with one; [`api`] serves it to every other AI tool in
//! the OpenAI and Anthropic formats. [`Local`] holds the live pieces and the settings.

pub mod api;
pub mod chat;
pub mod hub;
pub mod ollama;
pub mod settings;

use anyhow::Result;
use serde::Serialize;
use settings::{LocalSettings, SettingsFile};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// The endpoint as the window shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiState {
    pub enabled: bool,
    pub port: u16,
    pub running: bool,
    /// Why it is not running although switched on (the port taken, no credential store).
    pub error: Option<String>,
}

pub struct Local {
    pub settings: SettingsFile,
    api: Mutex<Option<api::Running>>,
    api_error: Mutex<Option<String>>,
}

impl Local {
    /// Read the settings and start the endpoint if it is switched on.
    pub fn open(dir: &Path) -> Arc<Self> {
        let local = Arc::new(Self { settings: SettingsFile::open(dir), api: Mutex::new(None), api_error: Mutex::new(None) });
        local.apply_api();
        local
    }

    pub fn base(&self) -> String {
        ollama::base()
    }

    /// The installed model the Brain answers with, if the person chose one.
    pub fn chat_model(&self) -> Option<String> {
        self.settings.get().chat_model.filter(|m| !m.trim().is_empty())
    }

    pub fn update(&self, change: impl FnOnce(&mut LocalSettings)) -> Result<LocalSettings> {
        let next = self.settings.update(change)?;
        self.apply_api();
        Ok(next)
    }

    /// Start, stop or move the endpoint to match the settings.
    pub fn apply_api(&self) {
        let s = self.settings.get();
        let mut slot = self.api.lock().unwrap();
        let mut error = self.api_error.lock().unwrap();
        if !s.api_enabled {
            *slot = None;
            *error = None;
            return;
        }
        if slot.as_ref().is_some_and(|r| r.port == s.api_port) {
            return;
        }
        *slot = None;
        match api::key().and_then(|k| api::start(s.api_port, k, ollama::base())) {
            Ok(r) => {
                *slot = Some(r);
                *error = None;
            }
            Err(e) => *error = Some(format!("{e:#}")),
        }
    }

    /// A new key: the endpoint restarts with it.
    pub fn rotate_key(&self) -> Result<String> {
        let k = api::rotate_key()?;
        *self.api.lock().unwrap() = None;
        self.apply_api();
        Ok(k)
    }

    pub fn api_state(&self) -> ApiState {
        let s = self.settings.get();
        ApiState {
            enabled: s.api_enabled,
            port: s.api_port,
            running: self.api.lock().unwrap().is_some(),
            error: self.api_error.lock().unwrap().clone(),
        }
    }
}
