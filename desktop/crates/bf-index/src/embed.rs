//! Embedding port. The index depends on this trait, never on a model crate, so it runs
//! (keyword + structure) with no embedder at all and tests use a deterministic stub.

use anyhow::Result;

/// Identity of the bundled local model. Known before the model loads, because it keys
/// the stored vectors (a lazily-loaded handle must report it up front).
pub const LOCAL_MODEL_FINGERPRINT: &str = "fastembed/bge-small-en-v1.5";

pub trait Embedder: Send + Sync {
    /// Model identity. Vectors are only comparable within one fingerprint; a change
    /// invalidates every stored vector rather than mixing two models' spaces.
    fn fingerprint(&self) -> String;
    fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>>;
}

/// The text a chunk is embedded as: where it lives and what it is named carry as much
/// signal as the body, and the body is capped so one huge chunk cannot dominate a batch.
pub fn chunk_embedding_text(path: &str, symbol: Option<&str>, body: &str) -> String {
    const MAX_BODY_CHARS: usize = 2000;
    let body: String = body.chars().take(MAX_BODY_CHARS).collect();
    match symbol {
        Some(s) => format!("{path}\n{s}\n{body}"),
        None => format!("{path}\n{body}"),
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let (mut dot, mut na, mut nb) = (0f32, 0f32, 0f32);
    for (x, y) in a.iter().zip(b) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        dot / (na.sqrt() * nb.sqrt())
    }
}

pub fn to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

pub fn from_blob(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

#[cfg(feature = "embeddings")]
pub mod local {
    //! fastembed (ONNX Runtime, CPU) — BGE-small, 384 dimensions, ~33 MB, downloaded once
    //! into the app's data directory on first use.
    use super::Embedder;
    use anyhow::Result;
    use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
    use std::path::Path;

    pub struct LocalEmbedder {
        model: TextEmbedding,
    }

    impl LocalEmbedder {
        pub fn load(cache_dir: &Path) -> Result<Self> {
            let opts = InitOptions::new(EmbeddingModel::BGESmallENV15)
                .with_cache_dir(cache_dir.to_path_buf())
                .with_show_download_progress(false);
            Ok(Self { model: TextEmbedding::try_new(opts)? })
        }
    }

    impl Embedder for LocalEmbedder {
        fn fingerprint(&self) -> String {
            super::LOCAL_MODEL_FINGERPRINT.into()
        }
        fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
            self.model.embed(texts.to_vec(), Some(32))
        }
    }
}

#[cfg(test)]
pub mod stub {
    //! Bag-of-terms hashing embedder: deterministic, and texts sharing terms are close.
    use super::Embedder;
    use anyhow::Result;

    pub struct HashEmbedder;

    impl Embedder for HashEmbedder {
        fn fingerprint(&self) -> String {
            "test/hash-64".into()
        }
        fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
            Ok(texts
                .iter()
                .map(|t| {
                    let mut v = vec![0f32; 64];
                    for term in crate::terms::search_terms(t) {
                        let h = blake3::hash(term.as_bytes());
                        v[(h.as_bytes()[0] as usize) % 64] += 1.0;
                    }
                    v
                })
                .collect())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blob_roundtrip_and_cosine() {
        let v = vec![1.0, -2.5, 3.25];
        assert_eq!(from_blob(&to_blob(&v)), v);
        assert!((cosine(&v, &v) - 1.0).abs() < 1e-6);
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 1.0]), 0.0);
    }
}
