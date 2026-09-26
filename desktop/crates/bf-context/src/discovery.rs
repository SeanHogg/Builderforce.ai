//! The discovery file — how a client (the VS Code extension, the MCP bridge) finds the
//! running service: `{ port, token, pid, version }` at `~/.builderforce/desktop.json`,
//! readable only by this user. Written on start, withdrawn on stop; a stale file left by
//! a crash is harmless because its port stops answering (clients probe `health`).

use crate::paths;
use anyhow::Result;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Discovery {
    pub port: u16,
    pub token: String,
    pub pid: u32,
    pub version: String,
}

pub fn publish(port: u16) -> Result<Discovery> {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let d = Discovery { port, token, pid: std::process::id(), version: env!("CARGO_PKG_VERSION").into() };
    let file = paths::discovery_file();
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    write_private(&file, &serde_json::to_vec_pretty(&d)?)?;
    Ok(d)
}

/// Remove the file only if it is still ours (a newer instance may have replaced it).
pub fn withdraw(d: &Discovery) {
    let file = paths::discovery_file();
    if read().map(|cur| cur.pid == d.pid && cur.port == d.port).unwrap_or(false) {
        let _ = std::fs::remove_file(file);
    }
}

pub fn read() -> Option<Discovery> {
    let raw = std::fs::read_to_string(paths::discovery_file()).ok()?;
    serde_json::from_str(&raw).ok()
}

/// The running service, if one answers its health check.
pub fn find_live() -> Option<Discovery> {
    let d = read()?;
    let ok = ureq::get(&format!("http://127.0.0.1:{}/v1/health", d.port))
        .set("Authorization", &format!("Bearer {}", d.token))
        .timeout(Duration::from_millis(800))
        .call()
        .is_ok();
    ok.then_some(d)
}

#[cfg(unix)]
fn write_private(path: &std::path::Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
    f.write_all(bytes)?;
    Ok(())
}

#[cfg(not(unix))]
fn write_private(path: &std::path::Path, bytes: &[u8]) -> Result<()> {
    // The file lives under the user's profile, whose ACL already excludes other users.
    std::fs::write(path, bytes)?;
    Ok(())
}
