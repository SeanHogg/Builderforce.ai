//! Platforms without a recorder yet (macOS: AX, Linux: AT-SPI — see the Gap Register).
//! The same surface as Windows, answering "not supported" so callers need no `cfg`.

use crate::RunHooks;
use anyhow::{anyhow, Result};
use crate::model::{RecordedStep, RunStatus, Skill};
use std::collections::BTreeMap;
use std::path::Path;

fn unsupported<T>() -> Result<T> {
    Err(anyhow!("recording and replay are available on Windows first; this platform is not supported yet"))
}

pub struct Recording;

impl Recording {
    pub fn steps(&self) -> Vec<RecordedStep> {
        Vec::new()
    }
    pub fn error(&self) -> Option<String> {
        None
    }
    pub fn is_running(&self) -> bool {
        false
    }
    pub fn stop(self) -> Vec<RecordedStep> {
        Vec::new()
    }
}

pub fn start_recording(_program: &str, _args: &[String], _shots_dir: &Path) -> Result<Recording> {
    unsupported()
}

pub fn run_skill(_skill: &Skill, _values: &BTreeMap<String, String>, _hooks: &mut dyn RunHooks) -> Result<RunStatus> {
    unsupported()
}

pub mod vault {
    use anyhow::Result;

    pub fn save(_skill_id: &str, _param: &str, _value: &str) -> Result<()> {
        super::unsupported()
    }
    pub fn load(_skill_id: &str, _param: &str) -> Option<String> {
        None
    }
    pub fn delete(_skill_id: &str, _param: &str) {}
}
