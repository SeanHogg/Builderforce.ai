//! Synapse's secrets, kept in the operating system's credential store (Windows Credential
//! Manager, the macOS Keychain, the Secret Service on Linux) under one service name. Two
//! things live here: the passwords skills use without anyone seeing them, and the
//! builderforce.ai sign-in key. Values never pass through a file Synapse writes.
//!
//! Where there is no store — another OS, or a Linux session with no Secret Service running
//! (a bare server, a headless shell) — saving fails with a clear error and nothing is
//! found, so a caller degrades to "not saved" rather than to a plaintext file.

use anyhow::Result;

const SERVICE: &str = "Synapse";

#[cfg(any(windows, target_os = "macos", target_os = "linux"))]
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

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
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

#[cfg(test)]
mod tests {
    /// Writes to the real credential store, so it runs only when asked:
    /// `cargo test -p bf-vault -- --ignored` (on Linux, inside a session with a Secret
    /// Service — e.g. `dbus-run-session` with `gnome-keyring-daemon --unlock`).
    #[test]
    #[ignore]
    fn round_trips_through_the_os_store() {
        let name = "bf-vault:self-test";
        super::save(name, "s3cret").expect("save");
        assert_eq!(super::load(name).as_deref(), Some("s3cret"));
        super::delete(name);
        assert_eq!(super::load(name), None);
    }
}
