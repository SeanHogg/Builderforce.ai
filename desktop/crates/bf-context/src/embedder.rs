//! The service's embedder: loaded once, lazily, shared by every workspace index.
//!
//! The model download (~33 MB, first run only) must not delay keyword search, so indexes
//! are opened with this handle immediately and it resolves the real model on first use.
//! If the model cannot load (offline first run), embedding reports an error, the index
//! stays keyword + structure, and `state()` says why.

use anyhow::{anyhow, Result};
use bf_index::Embedder;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EmbedderState {
    Loading,
    Ready,
    Unavailable,
    Disabled,
}

pub struct LazyEmbedder {
    cache_dir: PathBuf,
    cell: OnceLock<Result<Box<dyn Embedder>, String>>,
}

impl LazyEmbedder {
    pub fn new(cache_dir: PathBuf) -> Arc<Self> {
        Arc::new(Self { cache_dir, cell: OnceLock::new() })
    }

    /// Start loading now (on the caller's thread) so the first search does not pay for it.
    pub fn warm(&self) {
        let _ = self.resolve();
    }

    pub fn state(&self) -> EmbedderState {
        if !cfg!(feature = "embeddings") {
            return EmbedderState::Disabled;
        }
        match self.cell.get() {
            None => EmbedderState::Loading,
            Some(Ok(_)) => EmbedderState::Ready,
            Some(Err(_)) => EmbedderState::Unavailable,
        }
    }

    pub fn error(&self) -> Option<String> {
        self.cell.get().and_then(|r| r.as_ref().err().cloned())
    }

    fn resolve(&self) -> &Result<Box<dyn Embedder>, String> {
        self.cell.get_or_init(|| load(&self.cache_dir))
    }
}

#[cfg(feature = "embeddings")]
fn load(cache_dir: &std::path::Path) -> Result<Box<dyn Embedder>, String> {
    std::fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
    bf_index::embed::local::LocalEmbedder::load(cache_dir)
        .map(|e| Box::new(e) as Box<dyn Embedder>)
        .map_err(|e| format!("{e:#}"))
}

#[cfg(not(feature = "embeddings"))]
fn load(_: &std::path::Path) -> Result<Box<dyn Embedder>, String> {
    Err("built without the embeddings feature".into())
}

impl Embedder for LazyEmbedder {
    fn fingerprint(&self) -> String {
        bf_index::embed::LOCAL_MODEL_FINGERPRINT.into()
    }

    fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        match self.resolve() {
            Ok(e) => e.embed(texts),
            Err(msg) => Err(anyhow!("embedder unavailable: {msg}")),
        }
    }
}
