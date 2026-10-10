//! Approving a running skill's step from the phone. Synapse never exposes its loopback
//! service to the network: the request goes up to the person's Builderforce account as an
//! approval (`synapse.step`), where the web approvals queue — on any phone — shows it, and
//! Synapse polls it for the answer. Only the person who raised it can answer it; the
//! platform enforces that, so the account itself is the pairing.
//!
//! Opt-in (`phone_approvals`), and only while signed in. Offline or refused, a step simply
//! waits for the window's Approve, as it always has.

use super::Cloud;
use crate::agents::runs::{ApprovalRelay, APPROVAL_TIMEOUT};
use crate::agents::Agents;
use bf_teach::model::SkillAction;
use serde_json::{json, Value};
use std::sync::Arc;

/// The approval kind the platform keeps to its requester (`SELF_OWNED_ACTION_TYPES`).
pub const ACTION_TYPE: &str = "synapse.step";

pub struct PhoneApprovals {
    pub cloud: Arc<Cloud>,
    pub agents: std::sync::Weak<Agents>,
}

fn verdict(status: &str) -> Option<bool> {
    match status {
        "approved" => Some(true),
        "rejected" | "expired" => Some(false),
        _ => None,
    }
}

impl ApprovalRelay for PhoneApprovals {
    fn open(&self, skill: &str, run_id: &str, step: usize, action: Option<&SkillAction>) -> Option<String> {
        let on = self.agents.upgrade().is_some_and(|a| a.settings.get().phone_approvals);
        let s = self.cloud.require().ok().filter(|_| on)?;
        let expires = chrono::Utc::now() + chrono::Duration::from_std(APPROVAL_TIMEOUT).ok()?;
        let body = json!({
            "kind": "approval",
            "actionType": ACTION_TYPE,
            "description": crate::tray::phone_approval_text(skill, step),
            "metadata": { "runId": run_id, "skill": skill, "step": step + 1, "action": action },
            "expiresAt": expires.to_rfc3339(),
        });
        let v = s.api("POST", "/api/approvals", Some(body)).ok()?;
        v.get("approvalId").and_then(Value::as_str).map(str::to_string)
    }

    fn answer(&self, id: &str) -> Option<bool> {
        let v = self.cloud.require().ok()?.api("GET", &format!("/api/approvals/{id}"), None).ok()?;
        verdict(v.get("status").and_then(Value::as_str).unwrap_or(""))
    }

    fn close(&self, id: &str, approved: bool) {
        if let Ok(s) = self.cloud.require() {
            let status = if approved { "approved" } else { "rejected" };
            let _ = s.api("PATCH", &format!("/api/approvals/{id}"), Some(json!({ "status": status, "reviewNote": "Answered in Synapse" })));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::verdict;

    #[test]
    fn only_a_resolved_request_is_an_answer() {
        assert_eq!(verdict("approved"), Some(true));
        assert_eq!(verdict("rejected"), Some(false));
        assert_eq!(verdict("expired"), Some(false));
        assert_eq!(verdict("pending"), None);
    }
}
