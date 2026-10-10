//! Synapse's choices about local models (`local.json`): which installed model the Brain
//! answers with (none = the gateway), and whether the compatible endpoint is served, on
//! which port.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Beside Ollama's 11434, so it is easy to remember and unlikely to be taken.
pub const DEFAULT_API_PORT: u16 = 11435;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalSettings {
    /// The installed model the Brain answers with; `None` = through the gateway.
    pub chat_model: Option<String>,
    /// Serve `/v1/chat/completions` and `/v1/messages` on loopback.
    pub api_enabled: bool,
    pub api_port: u16,
}

impl Default for LocalSettings {
    fn default() -> Self {
        Self { chat_model: None, api_enabled: false, api_port: DEFAULT_API_PORT }
    }
}

pub struct SettingsFile {
    file: PathBuf,
    current: Mutex<LocalSettings>,
}

impl SettingsFile {
    pub fn open(dir: &Path) -> Self {
        let file = dir.join("local.json");
        let current = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        Self { file, current: Mutex::new(current) }
    }

    pub fn get(&self) -> LocalSettings {
        self.current.lock().unwrap().clone()
    }

    pub fn update(&self, change: impl FnOnce(&mut LocalSettings)) -> Result<LocalSettings> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_default_to_the_gateway_and_persist() {
        let dir = tempfile::tempdir().unwrap();
        let s = SettingsFile::open(dir.path());
        assert_eq!(s.get(), LocalSettings::default());
        s.update(|x| x.chat_model = Some("llama3.2:3b-instruct-q8_0".into())).unwrap();
        assert_eq!(SettingsFile::open(dir.path()).get().chat_model.as_deref(), Some("llama3.2:3b-instruct-q8_0"));
    }
}
