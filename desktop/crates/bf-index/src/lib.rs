//! bf-index — the local code index behind Builderforce Desktop.
//!
//! Structure (tree-sitter definitions, symbols, a reference-ranked repo map), keywords
//! (identifier-aware BM25) and meaning (local embeddings) over one SQLite file per
//! workspace, kept current by a file watcher. Everything stays on the machine.

pub mod chunk;
pub mod embed;
pub mod index;
pub mod lang;
pub mod refs;
pub mod repo_map;
pub mod search;
pub mod store;
pub mod terms;
pub mod walk;
pub mod watcher;

pub use embed::Embedder;
pub use index::{Hit, Index, IndexStatus, Phase, RefReport};
