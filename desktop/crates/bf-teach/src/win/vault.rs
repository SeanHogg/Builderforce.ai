//! Secret parameters in the Windows Credential Manager. A skill can use a saved password
//! without anyone — the window, the audit trail, the training data — ever showing it.

use anyhow::Result;

const SERVICE: &str = "Synapse";

fn entry(skill_id: &str, param: &str) -> keyring::Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, &format!("skill:{skill_id}:{param}"))
}

pub fn save(skill_id: &str, param: &str, value: &str) -> Result<()> {
    entry(skill_id, param)?.set_password(value)?;
    Ok(())
}

pub fn load(skill_id: &str, param: &str) -> Option<String> {
    entry(skill_id, param).ok()?.get_password().ok()
}

pub fn delete(skill_id: &str, param: &str) {
    if let Ok(e) = entry(skill_id, param) {
        let _ = e.delete_credential();
    }
}
