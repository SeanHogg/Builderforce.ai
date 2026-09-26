//! Which files in a workspace are indexed. Ignore-aware (.gitignore, .ignore, global git
//! excludes) plus a fixed deny-list of generated trees that are often NOT gitignored in a
//! monorepo's nested packages.

use crate::lang;
use std::path::{Path, PathBuf};

pub const MAX_FILE_BYTES: u64 = 1_000_000;

const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "dist", "build", "out", "target", ".next", ".turbo", ".cache", "coverage",
    "vendor", "__pycache__", ".venv", "venv", ".idea", ".vscode-test",
];

const SKIP_FILES: &[&str] = &["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "bun.lockb"];

/// Every indexable file under `root`, as absolute paths.
pub fn indexable_files(root: &Path) -> Vec<PathBuf> {
    let walker = ignore::WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false)
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.file_type().map(|t| t.is_dir()).unwrap_or(false) && SKIP_DIRS.contains(&name.as_ref()))
        })
        .build();
    walker
        .filter_map(Result::ok)
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.into_path())
        .filter(|p| is_indexable(root, p))
        .collect()
}

/// The per-path rule the watcher applies to change events (the walk above also gets
/// gitignore; a watched event only gets this cheaper check plus the deny-lists).
pub fn is_indexable(root: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else { return false };
    if rel.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        SKIP_DIRS.contains(&s.as_ref()) || (s.starts_with('.') && s.len() > 1 && s != ".github")
    }) {
        return false;
    }
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if SKIP_FILES.contains(&name) || name.ends_with(".min.js") || name.ends_with(".map") {
        return false;
    }
    if !(lang::detect(path).is_some() || lang::is_plain_text_source(path)) {
        return false;
    }
    std::fs::metadata(path).map(|m| m.len() <= MAX_FILE_BYTES).unwrap_or(false)
}

/// Repo-relative, forward-slash path — the key every table and every API result uses.
pub fn rel_key(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    Some(rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
}
