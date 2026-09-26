//! The set of workspaces this machine indexes. Each gets an index, an initial scan, a
//! background embed pass and a file watch. The list persists, so the service resumes
//! every workspace after a restart without the client having to re-register it.

use crate::embedder::{EmbedderState, LazyEmbedder};
use crate::paths;
use anyhow::{anyhow, Result};
use bf_index::watcher::{self, Watch};
use bf_index::{Embedder, Index, IndexStatus};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

struct Entry {
    index: Arc<Index>,
    _watch: Option<Watch>,
}

pub struct Registry {
    data_dir: PathBuf,
    embedder: Arc<LazyEmbedder>,
    workspaces: Mutex<BTreeMap<PathBuf, Entry>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub version: &'static str,
    pub embeddings: EmbedderState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embeddings_error: Option<String>,
    pub workspaces: usize,
}

impl Registry {
    pub fn new(data_dir: PathBuf) -> Arc<Self> {
        let embedder = LazyEmbedder::new(paths::model_cache(&data_dir));
        Arc::new(Self { data_dir, embedder, workspaces: Mutex::new(BTreeMap::new()) })
    }

    /// Warm the embedder and resume every persisted workspace, off the caller's thread.
    pub fn start_background(self: &Arc<Self>) {
        if cfg!(feature = "embeddings") {
            let e = self.embedder.clone();
            let _ = std::thread::Builder::new().name("bf-embedder-load".into()).spawn(move || e.warm());
        }
        for root in self.persisted_roots() {
            if let Err(e) = self.ensure(&root) {
                eprintln!("bf-context: could not resume {}: {e:#}", root.display());
            }
        }
    }

    pub fn health(&self) -> Health {
        Health {
            version: env!("CARGO_PKG_VERSION"),
            embeddings: self.embedder.state(),
            embeddings_error: self.embedder.error(),
            workspaces: self.workspaces.lock().unwrap().len(),
        }
    }

    /// The index for `root`, opening and starting it on first use. Idempotent.
    pub fn ensure(self: &Arc<Self>, root: &Path) -> Result<Arc<Index>> {
        let root = paths::canonical_root(root).map_err(|e| anyhow!("workspace {} not found: {e}", root.display()))?;
        if !root.is_dir() {
            return Err(anyhow!("workspace {} is not a directory", root.display()));
        }
        let mut ws = self.workspaces.lock().unwrap();
        if let Some(e) = ws.get(&root) {
            return Ok(e.index.clone());
        }
        let embedder: Option<Arc<dyn Embedder>> =
            if cfg!(feature = "embeddings") { Some(self.embedder.clone() as Arc<dyn Embedder>) } else { None };
        let index = Arc::new(Index::open(&root, &paths::index_db(&self.data_dir, &root), embedder)?);
        let watch = match watcher::watch(index.clone()) {
            Ok(w) => Some(w),
            Err(e) => {
                eprintln!("bf-context: watching {} failed ({e:#}); the index refreshes on rescan only", root.display());
                None
            }
        };
        let bg = index.clone();
        std::thread::Builder::new().name("bf-index-scan".into()).spawn(move || {
            if let Err(e) = bg.scan() {
                eprintln!("bf-context: scan of {} failed: {e:#}", bg.root().display());
                return;
            }
            if bg.embed_pending().is_err() {
                bg.embedding_unavailable();
            }
        })?;
        ws.insert(root.clone(), Entry { index: index.clone(), _watch: watch });
        drop(ws);
        self.persist();
        Ok(index)
    }

    pub fn remove(&self, root: &Path) -> Result<bool> {
        let root = paths::canonical_root(root).unwrap_or_else(|_| root.to_path_buf());
        let removed = self.workspaces.lock().unwrap().remove(&root).is_some();
        if removed {
            self.persist();
            let _ = std::fs::remove_file(paths::index_db(&self.data_dir, &root));
        }
        Ok(removed)
    }

    /// Force a full rescan (the watcher normally makes this unnecessary).
    pub fn rescan(self: &Arc<Self>, root: &Path) -> Result<()> {
        let index = self.ensure(root)?;
        std::thread::Builder::new().name("bf-index-rescan".into()).spawn(move || {
            if index.scan().is_ok() && index.embed_pending().is_err() {
                index.embedding_unavailable();
            }
        })?;
        Ok(())
    }

    pub fn statuses(&self) -> Vec<IndexStatus> {
        self.workspaces.lock().unwrap().values().map(|e| e.index.status()).collect()
    }

    fn persisted_roots(&self) -> Vec<PathBuf> {
        std::fs::read_to_string(paths::workspaces_file(&self.data_dir))
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<PathBuf>>(&s).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(|p| p.is_dir())
            .collect()
    }

    fn persist(&self) {
        let roots: Vec<PathBuf> = self.workspaces.lock().unwrap().keys().cloned().collect();
        let file = paths::workspaces_file(&self.data_dir);
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(&roots) {
            let _ = std::fs::write(file, json);
        }
    }
}
