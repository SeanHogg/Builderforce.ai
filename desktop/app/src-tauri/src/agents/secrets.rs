//! Secret parameter values: taken from the vault when the caller did not supply them
//! (routines never do), and saved to it when the person asks.

use bf_teach::model::Skill;
use std::collections::BTreeMap;

pub fn values_with_vault(skill: &Skill, mut values: BTreeMap<String, String>) -> BTreeMap<String, String> {
    for p in skill.params.iter().filter(|p| p.secret) {
        if !values.contains_key(&p.name) {
            if let Some(v) = bf_teach::vault::load(&skill.id, &p.name) {
                values.insert(p.name.clone(), v);
            }
        }
    }
    values
}

pub fn save_secrets(skill: &Skill, values: &BTreeMap<String, String>) -> anyhow::Result<()> {
    for p in skill.params.iter().filter(|p| p.secret) {
        if let Some(v) = values.get(&p.name) {
            bf_teach::vault::save(&skill.id, &p.name, v)?;
        }
    }
    Ok(())
}

/// Which of a skill's secrets are saved (names only — values never leave the vault).
pub fn saved_secrets(skill: &Skill) -> Vec<String> {
    skill.params.iter().filter(|p| p.secret && bf_teach::vault::load(&skill.id, &p.name).is_some()).map(|p| p.name.clone()).collect()
}

pub fn delete_secrets(skill: &Skill) {
    for p in skill.params.iter().filter(|p| p.secret) {
        bf_teach::vault::delete(&skill.id, &p.name);
    }
}
