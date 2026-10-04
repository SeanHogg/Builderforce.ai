//! Installing the Spawn Studio plugin — the step every other Roblox AI tool makes the
//! player do by hand.
//!
//! Roblox Studio loads any `.lua` file in its local plugins folder as a plugin, so
//! installing is writing one file there. The file carries this app's loopback port and
//! bridge key, so it is rewritten every time the app starts: the plugin and the app can
//! never disagree about where to meet, and an updated app ships an updated plugin
//! without anyone visiting the Creator Store.

use anyhow::{anyhow, Context, Result};
use std::path::PathBuf;

const SOURCE: &str = include_str!("../plugin/SpawnPlugin.lua");
/// The file's name in the plugins folder.
pub const PLUGIN_FILE: &str = "SpawnPlugin.lua";

/// Studio's local plugins folder: `%LOCALAPPDATA%\Roblox\Plugins` on Windows,
/// `~/Documents/Roblox/Plugins` on macOS. None where Studio does not run.
pub fn plugins_dir() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        dirs::data_local_dir().map(|d| d.join("Roblox").join("Plugins"))
    } else if cfg!(target_os = "macos") {
        dirs::document_dir().map(|d| d.join("Roblox").join("Plugins"))
    } else {
        None
    }
}

/// The plugin's source for this port and key.
pub fn render(port: u16, token: &str) -> String {
    SOURCE.replace("{{PORT}}", &port.to_string()).replace("{{TOKEN}}", token)
}

/// Write (or rewrite) the plugin into `dir`. Returns the file written.
pub fn install_into(dir: &std::path::Path, port: u16, token: &str) -> Result<PathBuf> {
    std::fs::create_dir_all(dir).with_context(|| format!("could not create {}", dir.display()))?;
    let path = dir.join(PLUGIN_FILE);
    let source = render(port, token);
    // Unchanged file, untouched: Studio reloads a plugin whose file changes.
    if std::fs::read_to_string(&path).ok().as_deref() != Some(source.as_str()) {
        std::fs::write(&path, source).with_context(|| format!("could not write {}", path.display()))?;
    }
    Ok(path)
}

/// Install into Studio's plugins folder.
pub fn install(port: u16, token: &str) -> Result<PathBuf> {
    let dir = plugins_dir().ok_or_else(|| anyhow!("Roblox Studio does not run on this system"))?;
    install_into(&dir, port, token)
}

/// Is the plugin in Studio's plugins folder?
pub fn installed() -> bool {
    plugins_dir().map(|d| d.join(PLUGIN_FILE).is_file()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_the_port_and_key_into_the_plugin() {
        let source = render(34873, "abc123");
        assert!(source.contains("local PORT = 34873"));
        assert!(source.contains("local TOKEN = \"abc123\""));
        assert!(!source.contains("{{"));
    }

    #[test]
    fn installs_and_rewrites_only_when_it_changed() {
        let dir = tempfile::tempdir().unwrap();
        let path = install_into(dir.path(), 1, "a").unwrap();
        let first = std::fs::metadata(&path).unwrap().modified().unwrap();
        install_into(dir.path(), 1, "a").unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().modified().unwrap(), first);
        install_into(dir.path(), 2, "a").unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains("local PORT = 2"));
    }
}
