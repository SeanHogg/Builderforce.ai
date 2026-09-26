//! Where the service keeps its state. All of it is per-user and outside every repo.

use std::path::{Path, PathBuf};

/// `~/.builderforce/desktop` — indexes, the model cache, the workspace list.
pub fn data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("BUILDERFORCE_DESKTOP_HOME") {
        return PathBuf::from(dir);
    }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".builderforce").join("desktop")
}

/// The discovery file clients read to find the running service: `{port, token, pid, version}`.
/// It lives beside, not inside, the data dir so its location never depends on an override
/// the client process might not share.
pub fn discovery_file() -> PathBuf {
    if let Ok(p) = std::env::var("BUILDERFORCE_DESKTOP_DISCOVERY") {
        return PathBuf::from(p);
    }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".builderforce").join("desktop.json")
}

pub fn index_db(data_dir: &Path, root: &Path) -> PathBuf {
    let key = blake3::hash(root.to_string_lossy().as_bytes()).to_hex();
    data_dir.join("indexes").join(format!("{}.db", &key[..16]))
}

pub fn workspaces_file(data_dir: &Path) -> PathBuf {
    data_dir.join("workspaces.json")
}

pub fn model_cache(data_dir: &Path) -> PathBuf {
    data_dir.join("models")
}

/// Canonical form of a workspace root, so `C:\repo`, `c:/repo/` and a symlink all key the
/// same index. Windows' `\\?\` verbatim prefix is stripped because clients never send it.
pub fn canonical_root(root: &Path) -> std::io::Result<PathBuf> {
    let canon = std::fs::canonicalize(root)?;
    let s = canon.to_string_lossy();
    Ok(match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => canon,
    })
}
