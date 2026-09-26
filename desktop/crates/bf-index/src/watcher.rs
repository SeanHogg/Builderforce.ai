//! File watching — debounced change events become incremental re-index + embed passes,
//! so the index stays current without periodic full scans.

use crate::index::Index;
use crate::walk;
use anyhow::Result;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult, Debouncer};
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

const DEBOUNCE: Duration = Duration::from_millis(750);

/// Keeps the watch alive; dropping it stops watching.
pub struct Watch {
    _debouncer: Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
}

pub fn watch(index: Arc<Index>) -> Result<Watch> {
    let (tx, rx) = mpsc::channel::<Vec<PathBuf>>();
    let root = index.root().to_path_buf();
    let filter_root = root.clone();
    let mut debouncer = new_debouncer(DEBOUNCE, move |res: DebounceEventResult| {
        if let Ok(events) = res {
            let paths: Vec<PathBuf> = events
                .into_iter()
                .map(|e| e.path)
                // Deletions cannot pass `is_indexable` (no metadata), so only the cheap
                // path checks apply here; the index decides re-index vs remove.
                .filter(|p| walk::rel_key(&filter_root, p).is_some() && !in_skipped_dir(&filter_root, p))
                .collect();
            if !paths.is_empty() {
                let _ = tx.send(paths);
            }
        }
    })?;
    debouncer.watcher().watch(&root, RecursiveMode::Recursive)?;

    std::thread::Builder::new().name("bf-index-watch".into()).spawn(move || {
        while let Ok(mut paths) = rx.recv() {
            // Coalesce whatever else queued while the last batch ran.
            while let Ok(more) = rx.try_recv() {
                paths.extend(more);
            }
            paths.sort();
            paths.dedup();
            if index.reindex_paths(&paths).unwrap_or(0) > 0 {
                let _ = index.embed_pending();
            }
        }
    })?;
    Ok(Watch { _debouncer: debouncer })
}

fn in_skipped_dir(root: &std::path::Path, p: &std::path::Path) -> bool {
    p.strip_prefix(root)
        .map(|rel| {
            rel.components().any(|c| {
                let s = c.as_os_str().to_string_lossy();
                matches!(s.as_ref(), ".git" | "node_modules" | "target" | "dist" | ".next")
            })
        })
        .unwrap_or(true)
}
