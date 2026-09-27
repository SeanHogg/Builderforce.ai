//! Synapse's secrets, kept in the operating system's credential store (Windows Credential
//! Manager, the macOS Keychain) under one service name. Two things live here: the
//! passwords skills use without anyone seeing them, and the builderforce.ai sign-in key.
//! Values never pass through a file Synapse writes.
//!
//! Where there is no supported store (Linux, for now), saving fails with a clear error and
//! nothing is found, so a caller degrades to "not saved" rather than to a plaintext file.

use anyhow::Result;

const SERVICE: &str = "Synapse";

#[cfg(any(windows, target_os = "macos"))]
mod store {
    use super::SERVICE;
    use anyhow::Result;

    fn entry(name: &str) -> keyring::Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, name)
    }
    pub fn save(name: &str, value: &str) -> Result<()> {
        entry(name)?.set_password(value)?;
        Ok(())
    }
    pub fn load(name: &str) -> Option<String> {
        entry(name).ok()?.get_password().ok()
    }
    pub fn delete(name: &str) {
        if let Ok(e) = entry(name) {
            let _ = e.delete_credential();
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod store {
    use anyhow::Result;

    pub fn save(_name: &str, _value: &str) -> Result<()> {
        anyhow::bail!("this system has no supported credential store yet")
    }
    pub fn load(_name: &str) -> Option<String> {
        None
    }
    pub fn delete(_name: &str) {}
}

/// Whether secrets can be kept on this system.
pub fn supported() -> bool {
    cfg!(any(windows, target_os = "macos"))
}

/// Keep `value` under `name`, replacing what was there.
pub fn save(name: &str, value: &str) -> Result<()> {
    store::save(name, value)
}

pub fn load(name: &str) -> Option<String> {
    store::load(name)
}

pub fn delete(name: &str) {
    store::delete(name)
}

/// The entry name of a skill's secret parameter.
pub fn skill_secret(skill_id: &str, param: &str) -> String {
    format!("skill:{skill_id}:{param}")
}
