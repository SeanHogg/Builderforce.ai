//! One workspace's index: keeps the store in step with the files, embeds in the
//! background, and answers search / repo-map / reference checks.
//!
//! Keyword search is available as soon as the scan has passed a file; vectors join the
//! ranking as the embedder catches up. Nothing waits on the embedder.

use crate::chunk;
use crate::embed::{self, Embedder};
use crate::refs::{self, CodeRef, RefKind};
use crate::repo_map::{self, RepoMapOptions};
use crate::search::{self, Source};
use crate::store::{ChunkRow, Store};
use crate::terms;
use crate::walk;
use anyhow::Result;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

const CANDIDATES: usize = 60;
const MAX_LIMIT: usize = 25;
const SNIPPET_MAX_LINES: usize = 80;
const EMBED_BATCH: usize = 64;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum Phase {
    Scanning { done: usize, total: usize },
    Embedding,
    Ready,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub root: String,
    pub phase: Phase,
    pub files: usize,
    pub chunks: usize,
    pub embedded: usize,
    pub symbols: usize,
    pub embeddings_enabled: bool,
    pub last_indexed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub symbol: Option<String>,
    pub kind: String,
    pub snippet: String,
    pub score: f32,
    pub source: Source,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefReport {
    /// Index of the text in the request.
    pub index: usize,
    pub checked: usize,
    pub missing: Vec<CodeRef>,
}

type VectorCache = Arc<Vec<(i64, String, Vec<f32>)>>;

pub struct Index {
    root: PathBuf,
    store: Mutex<Store>,
    /// Serialises writers (initial scan vs watcher batches); readers only take `store`.
    write_lock: Mutex<()>,
    embedder: Option<Arc<dyn Embedder>>,
    phase: RwLock<Phase>,
    vectors: RwLock<Option<VectorCache>>,
    /// Bumped on every content change; keys the repo-map cache.
    generation: AtomicU64,
    map_cache: Mutex<Option<(u64, String, String)>>,
    last_indexed_at: AtomicI64,
}

impl Index {
    pub fn open(root: &Path, db_path: &Path, embedder: Option<Arc<dyn Embedder>>) -> Result<Self> {
        Self::with_store(root, Store::open(db_path)?, embedder)
    }

    fn with_store(root: &Path, store: Store, embedder: Option<Arc<dyn Embedder>>) -> Result<Self> {
        if let Some(e) = &embedder {
            let fp = e.fingerprint();
            if store.meta("embedder")?.as_deref() != Some(fp.as_str()) {
                store.clear_embeddings()?;
                store.set_meta("embedder", &fp)?;
            }
        }
        let last = store.meta("last_indexed_at")?.and_then(|v| v.parse().ok()).unwrap_or(0);
        Ok(Self {
            root: root.to_path_buf(),
            store: Mutex::new(store),
            write_lock: Mutex::new(()),
            embedder,
            phase: RwLock::new(Phase::Scanning { done: 0, total: 0 }),
            vectors: RwLock::new(None),
            generation: AtomicU64::new(1),
            map_cache: Mutex::new(None),
            last_indexed_at: AtomicI64::new(last),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Bring the store in line with the tree: re-chunk changed files, drop deleted ones.
    pub fn scan(&self) -> Result<()> {
        let _w = self.write_lock.lock().unwrap();
        let files = walk::indexable_files(&self.root);
        let total = files.len();
        *self.phase.write().unwrap() = Phase::Scanning { done: 0, total };
        let mut seen = std::collections::HashSet::with_capacity(total);
        for (i, abs) in files.iter().enumerate() {
            if let Some(key) = walk::rel_key(&self.root, abs) {
                self.index_file(abs, &key)?;
                seen.insert(key);
            }
            if i % 50 == 0 {
                *self.phase.write().unwrap() = Phase::Scanning { done: i, total };
            }
        }
        let stale: Vec<String> = {
            let store = self.store.lock().unwrap();
            store.all_paths()?.into_iter().filter(|p| !seen.contains(p)).collect()
        };
        for p in stale {
            self.store.lock().unwrap().remove_file(&p)?;
        }
        self.changed();
        *self.phase.write().unwrap() = self.settled_phase();
        Ok(())
    }

    /// Apply watcher events: re-index what exists, remove what is gone.
    pub fn reindex_paths(&self, paths: &[PathBuf]) -> Result<usize> {
        let _w = self.write_lock.lock().unwrap();
        let mut touched = 0;
        for abs in paths {
            let Some(key) = walk::rel_key(&self.root, abs) else { continue };
            if abs.is_file() && walk::is_indexable(&self.root, abs) {
                if self.index_file(abs, &key)? {
                    touched += 1;
                }
            } else if self.store.lock().unwrap().file_hash(&key)?.is_some() {
                self.store.lock().unwrap().remove_file(&key)?;
                touched += 1;
            }
        }
        if touched > 0 {
            self.changed();
            *self.phase.write().unwrap() = self.settled_phase();
        }
        Ok(touched)
    }

    /// Returns whether the file's content changed (and was re-chunked).
    fn index_file(&self, abs: &Path, key: &str) -> Result<bool> {
        let Ok(bytes) = std::fs::read(abs) else { return Ok(false) };
        let hash = blake3::hash(&bytes).to_hex().to_string();
        if self.store.lock().unwrap().file_hash(key)?.as_deref() == Some(hash.as_str()) {
            return Ok(false);
        }
        let Ok(source) = String::from_utf8(bytes) else { return Ok(false) };
        let fc = chunk::chunk_file(abs, &source);
        self.store.lock().unwrap().replace_file(key, &hash, &fc, now())?;
        Ok(true)
    }

    fn changed(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        *self.vectors.write().unwrap() = None;
        let t = now();
        self.last_indexed_at.store(t, Ordering::SeqCst);
        let _ = self.store.lock().unwrap().set_meta("last_indexed_at", &t.to_string());
    }

    fn settled_phase(&self) -> Phase {
        let pending = self.embedder.is_some()
            && self.store.lock().unwrap().counts().map(|c| c.embedded < c.chunks).unwrap_or(false);
        if pending {
            Phase::Embedding
        } else {
            Phase::Ready
        }
    }

    /// Embed every chunk still lacking a vector. The store lock is released while the
    /// model runs so searches are never blocked behind an embedding batch.
    pub fn embed_pending(&self) -> Result<usize> {
        let Some(embedder) = self.embedder.clone() else { return Ok(0) };
        let mut total = 0;
        loop {
            let batch = self.store.lock().unwrap().unembedded(EMBED_BATCH)?;
            if batch.is_empty() {
                break;
            }
            let texts: Vec<String> =
                batch.iter().map(|c| embed::chunk_embedding_text(&c.path, c.symbol.as_deref(), &c.text)).collect();
            let vectors = embedder.embed(&texts)?;
            let rows: Vec<(i64, Vec<f32>)> = batch.iter().map(|c| c.id).zip(vectors).collect();
            total += rows.len();
            self.store.lock().unwrap().set_embeddings(&rows)?;
            *self.vectors.write().unwrap() = None;
        }
        *self.phase.write().unwrap() = self.settled_phase();
        Ok(total)
    }

    /// The embedder could not run: the index is complete as keyword + structure, so it is
    /// Ready rather than stuck reporting Embedding forever.
    pub fn embedding_unavailable(&self) {
        *self.phase.write().unwrap() = Phase::Ready;
    }

    pub fn status(&self) -> IndexStatus {
        let counts = self.store.lock().unwrap().counts().unwrap_or_default();
        let last = self.last_indexed_at.load(Ordering::SeqCst);
        IndexStatus {
            root: self.root.to_string_lossy().into_owned(),
            phase: self.phase.read().unwrap().clone(),
            files: counts.files,
            chunks: counts.chunks,
            embedded: counts.embedded,
            symbols: counts.symbols,
            embeddings_enabled: self.embedder.is_some(),
            last_indexed_at: (last > 0).then_some(last),
        }
    }

    pub fn search(&self, query: &str, limit: usize, path_prefix: Option<&str>) -> Result<Vec<Hit>> {
        let limit = limit.clamp(1, MAX_LIMIT);
        let prefix = path_prefix.map(|p| p.trim_start_matches("./").replace('\\', "/")).filter(|p| !p.is_empty());
        let keyword = match terms::fts_query(query) {
            Some(fts) => self.store.lock().unwrap().keyword_search(&fts, prefix.as_deref(), CANDIDATES)?,
            None => Vec::new(),
        };
        // A missing or failed embedder (offline first run, model load error) degrades the
        // ranking to keyword + structure; it never fails the search.
        let vector = self.vector_candidates(query, prefix.as_deref()).unwrap_or_default();
        let mut rows: HashMap<i64, ChunkRow> = HashMap::new();
        {
            let ids: Vec<i64> = keyword.iter().chain(vector.iter()).copied().collect();
            for row in self.store.lock().unwrap().chunks_by_ids(&ids)? {
                rows.insert(row.id, row);
            }
        }
        let words: Vec<String> = terms::identifiers(query, 2).map(|w| w.to_ascii_lowercase()).collect();
        let fused = search::fuse(&keyword, &vector, &words, |id| rows.get(&id).and_then(|r| r.symbol.clone()));
        Ok(fused
            .into_iter()
            .filter_map(|f| {
                let r = rows.get(&f.id)?;
                Some(Hit {
                    path: r.path.clone(),
                    start_line: r.start_line,
                    end_line: r.end_line,
                    symbol: r.symbol.clone(),
                    kind: r.kind.clone(),
                    snippet: snippet(&r.text),
                    score: f.score,
                    source: f.source,
                })
            })
            .take(limit)
            .collect())
    }

    fn vector_candidates(&self, query: &str, prefix: Option<&str>) -> Result<Vec<i64>> {
        let Some(embedder) = &self.embedder else { return Ok(Vec::new()) };
        let cache = self.vector_cache()?;
        if cache.is_empty() {
            return Ok(Vec::new());
        }
        let q = embedder.embed(&[query.to_string()])?.pop().unwrap_or_default();
        let mut scored: Vec<(f32, i64)> = cache
            .iter()
            .filter(|(_, path, _)| prefix.map(|p| path.starts_with(p)).unwrap_or(true))
            .map(|(id, _, v)| (embed::cosine(&q, v), *id))
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        Ok(scored.into_iter().take(CANDIDATES).map(|(_, id)| id).collect())
    }

    fn vector_cache(&self) -> Result<VectorCache> {
        if let Some(c) = self.vectors.read().unwrap().as_ref() {
            return Ok(c.clone());
        }
        let loaded: VectorCache = Arc::new(self.store.lock().unwrap().all_embeddings()?);
        *self.vectors.write().unwrap() = Some(loaded.clone());
        Ok(loaded)
    }

    /// The repo map, cached per content generation (it only changes when files do).
    pub fn repo_map(&self, max_tokens: usize, focus: &[String]) -> Result<String> {
        let generation = self.generation.load(Ordering::SeqCst);
        let key = format!("{max_tokens}|{}", focus.join(","));
        if let Some((g, k, map)) = self.map_cache.lock().unwrap().as_ref() {
            if *g == generation && *k == key {
                return Ok(map.clone());
            }
        }
        let symbols = self.store.lock().unwrap().symbols_ranked()?;
        let map = repo_map::render(&symbols, &RepoMapOptions { max_tokens, focus });
        *self.map_cache.lock().unwrap() = Some((generation, key, map.clone()));
        Ok(map)
    }

    /// For each text, the code references it names that the index cannot find.
    /// While a scan is still running an absent name may simply not be indexed YET, so
    /// nothing is reported missing (`checked: 0`) — a false "stale" flag would teach the
    /// agent to distrust a memory that is right.
    pub fn check_references(&self, texts: &[String]) -> Result<Vec<RefReport>> {
        if matches!(*self.phase.read().unwrap(), Phase::Scanning { .. }) {
            return Ok((0..texts.len()).map(|index| RefReport { index, checked: 0, missing: Vec::new() }).collect());
        }
        let store = self.store.lock().unwrap();
        let mut out = Vec::with_capacity(texts.len());
        for (index, text) in texts.iter().enumerate() {
            let found = refs::extract(text);
            let mut missing = Vec::new();
            for r in &found {
                let exists = match r.kind {
                    RefKind::Path => store.path_exists(&r.reference)?,
                    RefKind::Symbol => store.symbol_exists(&r.reference)? || store.ident_exists(&r.reference)?,
                };
                if !exists {
                    missing.push(r.clone());
                }
            }
            out.push(RefReport { index, checked: found.len(), missing });
        }
        Ok(out)
    }
}

fn snippet(text: &str) -> String {
    let mut lines = text.lines();
    let head: Vec<&str> = lines.by_ref().take(SNIPPET_MAX_LINES).collect();
    let rest = lines.count();
    let mut s = head.join("\n");
    if rest > 0 {
        s.push_str(&format!("\n… {rest} more lines"));
    }
    s
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::embed::stub::HashEmbedder;
    use std::fs;

    fn workspace() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src");
        fs::create_dir_all(&src).unwrap();
        fs::write(
            src.join("membership.ts"),
            "export function resolveMembership(userId: string) {\n  return tenantRoles(userId);\n}\n",
        )
        .unwrap();
        fs::write(
            src.join("limits.ts"),
            "export class PlanLimits {\n  check(seats: number) {\n    return seats < 5;\n  }\n}\n",
        )
        .unwrap();
        fs::write(src.join("use.ts"), "import { PlanLimits } from './limits';\nnew PlanLimits().check(3);\n").unwrap();
        fs::create_dir_all(dir.path().join("node_modules/x")).unwrap();
        fs::write(dir.path().join("node_modules/x/index.js"), "function resolveMembership() {}\n").unwrap();
        dir
    }

    fn index(dir: &Path, embed: bool) -> Index {
        let emb: Option<Arc<dyn Embedder>> = if embed { Some(Arc::new(HashEmbedder)) } else { None };
        let idx = Index::with_store(dir, Store::in_memory().unwrap(), emb).unwrap();
        idx.scan().unwrap();
        idx.embed_pending().unwrap();
        idx
    }

    #[test]
    fn keyword_search_finds_split_identifier_and_skips_node_modules() {
        let dir = workspace();
        let idx = index(dir.path(), false);
        let hits = idx.search("where is membership resolved", 5, None).unwrap();
        assert_eq!(hits[0].path, "src/membership.ts");
        assert_eq!(hits[0].symbol.as_deref(), Some("resolveMembership"));
        assert!(hits.iter().all(|h| !h.path.contains("node_modules")));
        assert_eq!(idx.status().phase, Phase::Ready);
    }

    #[test]
    fn vectors_join_ranking_and_prefix_filters() {
        let dir = workspace();
        let idx = index(dir.path(), true);
        let st = idx.status();
        assert_eq!(st.embedded, st.chunks);
        let hits = idx.search("PlanLimits seats", 5, Some("src/limits")).unwrap();
        assert!(!hits.is_empty());
        assert!(hits.iter().all(|h| h.path == "src/limits.ts"));
        assert!(hits.iter().any(|h| h.source == Source::Both));
    }

    #[test]
    fn repo_map_ranks_referenced_file_and_caches() {
        let dir = workspace();
        let idx = index(dir.path(), false);
        let map = idx.repo_map(500, &[]).unwrap();
        assert!(map.find("src/limits.ts").unwrap() < map.find("src/membership.ts").unwrap());
        assert_eq!(idx.repo_map(500, &[]).unwrap(), map);
    }

    #[test]
    fn reindex_detects_deleted_symbol_for_reference_check() {
        let dir = workspace();
        let idx = index(dir.path(), false);
        let memory = vec!["Always call `resolveMembership()` in src/membership.ts before `PlanLimits`.".to_string()];
        let before = idx.check_references(&memory).unwrap();
        assert!(before[0].missing.is_empty(), "{:?}", before[0].missing);
        assert_eq!(before[0].checked, 3);

        let f = dir.path().join("src/membership.ts");
        fs::remove_file(&f).unwrap();
        assert_eq!(idx.reindex_paths(&[f]).unwrap(), 1);
        let after = idx.check_references(&memory).unwrap();
        let missing: Vec<_> = after[0].missing.iter().map(|m| m.reference.as_str()).collect();
        assert!(missing.contains(&"resolveMembership"));
        assert!(missing.contains(&"src/membership.ts"));
        assert!(!missing.contains(&"PlanLimits"));
    }
}
