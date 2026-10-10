//! A private model to start from. Experience trains the person's own `.evermind`, but most
//! people have none to pick. A workspace Evermind they can already see (the models the
//! source picker lists) is a good start: Synapse downloads its published package — and the
//! tokenizer beside it, where memory-mcp looks for one (`<model>.tokenizer.json`) — into
//! the data folder and makes it the private model. From then on it learns on this machine
//! only; nothing flows back unless the person publishes it.

use super::{Cloud, Res};
use crate::agents::Agents;
use bf_cloud::CloudError;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::State;

const MAX_MODEL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_TOKENIZER_BYTES: u64 = 64 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// A file name from a model's name: letters, digits and dashes.
fn file_stem(name: &str, project_id: i64) -> String {
    let mut stem: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    stem = stem.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if stem.is_empty() {
        stem = "evermind".into();
    }
    format!("{stem}-{project_id}")
}

fn models_dir() -> PathBuf {
    bf_context::paths::data_dir().join("evermind")
}

#[tauri::command]
pub async fn evermind_fetch_model(cloud: State<'_, Arc<Cloud>>, agents: State<'_, Arc<Agents>>, project_id: i64, name: String) -> Res<String> {
    let (cloud, agents) = (cloud.inner().clone(), agents.inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        let s = cloud.require()?;
        let base = format!("/api/projects/{project_id}/evermind");
        let model = s.api_bytes(&format!("{base}/model"), MAX_MODEL_BYTES, DOWNLOAD_TIMEOUT).map_err(|e| cloud.fail(e))?;
        let tokenizer = match s.api_bytes(&format!("{base}/tokenizer"), MAX_TOKENIZER_BYTES, DOWNLOAD_TIMEOUT) {
            Ok(t) => Some(t),
            // A package with its tokenizer inside has none beside it.
            Err(CloudError::Status { code: 404, .. }) => None,
            Err(e) => return Err(cloud.fail(e)),
        };
        let dir = models_dir();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join(format!("{}.evermind", file_stem(&name, project_id)));
        std::fs::write(&path, model).map_err(|e| e.to_string())?;
        if let Some(t) = tokenizer {
            let tok = PathBuf::from(format!("{}.tokenizer.json", path.to_string_lossy()));
            std::fs::write(tok, t).map_err(|e| e.to_string())?;
        }
        let path = path.to_string_lossy().into_owned();
        agents.settings.update(|st| st.model_file = Some(path.clone())).map_err(|e| e.to_string())?;
        agents.mem.set_model_file(Some(&path));
        Ok(path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::file_stem;

    #[test]
    fn a_model_name_becomes_a_safe_file_name() {
        assert_eq!(file_stem("Acme Support / v2", 42), "acme-support-v2-42");
        assert_eq!(file_stem("…", 7), "evermind-7");
    }
}
