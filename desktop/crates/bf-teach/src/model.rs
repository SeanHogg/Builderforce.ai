//! The experience wire types, as `@seanhogg/builderforce-memory-engine` defines them
//! (`src/experience/types.ts`): camelCase JSON, actions tagged by `kind`, epoch-millisecond
//! timestamps. The engine owns the domain — Train Once, approval gates, routines, storage
//! (through memory-mcp); this crate only produces what a recording captured and consumes
//! the skills it replays, so it mirrors exactly the fields it reads or writes. Anything
//! else on the wire (a skill's routine, say) passes through untouched.

use serde::{Deserialize, Serialize};

/// A UI element, identified the way UI Automation sees it, plus where it was acted on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ElementRef {
    pub name: String,
    pub automation_id: String,
    /// `Button`, `Edit`, `MenuItem`, … (the UI Automation control type).
    pub control_type: String,
    pub class_name: String,
    /// The top-level window the element sits in.
    pub window_title: String,
    pub process_name: String,
    /// The point acted on, relative to the window's top-left — the fallback when the
    /// element cannot be found by identity at replay.
    pub rel_x: i32,
    pub rel_y: i32,
}

impl ElementRef {
    /// The label a person would use for it: its name, else its automation id (the
    /// engine's `elementLabel`).
    pub fn label(&self) -> &str {
        if !self.name.trim().is_empty() { self.name.trim() } else { self.automation_id.trim() }
    }
}

/// One thing the person did, as recorded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Action {
    Click { target: ElementRef },
    /// A field's value changed. `secret` fields (passwords) are recorded without a value.
    #[serde(rename_all = "camelCase")]
    SetValue { target: ElementRef, value: String, #[serde(default)] secret: bool },
    /// A key or shortcut that is an action in itself: `Enter`, `Tab`, `Ctrl+S`.
    Keys { keys: String, #[serde(default)] target: Option<ElementRef> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedStep {
    pub id: String,
    /// Milliseconds since the recording started.
    pub at_ms: u64,
    pub action: Action,
    /// Screenshot file name inside the episode's folder.
    #[serde(default)]
    pub screenshot: Option<String>,
}

/// One demonstration: a program Synapse launched, and what the person did in it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Episode {
    pub id: String,
    pub name: String,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Epoch milliseconds.
    pub started_at: i64,
    #[serde(default)]
    pub ended_at: Option<i64>,
    pub steps: Vec<RecordedStep>,
}

/// A value a skill asks for at run time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillParam {
    pub name: String,
    pub label: String,
    #[serde(default)]
    pub default: Option<String>,
    pub secret: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "from", rename_all = "camelCase")]
pub enum SkillValue {
    Param { name: String },
    Literal { text: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SkillAction {
    Click { target: ElementRef },
    SetValue { target: ElementRef, value: SkillValue },
    Keys { keys: String, #[serde(default)] target: Option<ElementRef> },
}

impl SkillAction {
    pub fn target(&self) -> Option<&ElementRef> {
        match self {
            SkillAction::Click { target } | SkillAction::SetValue { target, .. } => Some(target),
            SkillAction::Keys { target, .. } => target.as_ref(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillStep {
    pub id: String,
    pub action: SkillAction,
    /// Pause and ask the person before doing this step.
    pub requires_approval: bool,
    #[serde(default)]
    pub screenshot: Option<String>,
}

/// A Train Once skill — the fields replay reads.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub params: Vec<SkillParam>,
    pub steps: Vec<SkillStep>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Running,
    Succeeded,
    Failed,
    /// The person pressed Esc or Stop.
    Stopped,
    /// The person declined an approval.
    Denied,
}

impl RunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            RunStatus::Running => "running",
            RunStatus::Succeeded => "succeeded",
            RunStatus::Failed => "failed",
            RunStatus::Stopped => "stopped",
            RunStatus::Denied => "denied",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StepOutcome {
    /// Done by accessibility identity, and verified where there was something to verify.
    Ok,
    /// The element was not found by identity; done at its recorded position.
    Fallback,
    Failed,
    Approved,
    Denied,
}

impl StepOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            StepOutcome::Ok => "ok",
            StepOutcome::Fallback => "fallback",
            StepOutcome::Failed => "failed",
            StepOutcome::Approved => "approved",
            StepOutcome::Denied => "denied",
        }
    }
}

/// A short random id (16 hex chars), in the engine's `newExperienceId` alphabet — safe as
/// a folder name, which is what an episode id also is.
pub fn new_id() -> String {
    format!("{:016x}", rand::random::<u64>())
}

/// Epoch milliseconds — the engine's timestamp unit.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_engines_skill_json_and_ignores_what_it_does_not_use() {
        let json = r#"{"id":"s","name":"Invoice","program":"ledger.exe","args":[],"sourceEpisode":"e","createdAt":1,
            "routine":{"schedule":{"every":"minutes","minutes":5},"values":{},"enabled":true},
            "params":[{"name":"amount","label":"Amount","default":"250","secret":false}],
            "steps":[{"id":"a","requiresApproval":true,"screenshot":null,
                      "action":{"kind":"setValue","target":{"name":"Amount","controlType":"Edit"},"value":{"from":"param","name":"amount"}}}]}"#;
        let skill: Skill = serde_json::from_str(json).unwrap();
        assert_eq!(skill.params[0].name, "amount");
        assert!(matches!(&skill.steps[0].action, SkillAction::SetValue { value: SkillValue::Param { name }, .. } if name == "amount"));
        assert_eq!(skill.steps[0].action.target().unwrap().label(), "Amount");
    }

    #[test]
    fn writes_episodes_in_the_engines_shape() {
        let ep = Episode {
            id: new_id(),
            name: "n".into(),
            program: "p".into(),
            args: vec![],
            started_at: 1,
            ended_at: None,
            steps: vec![RecordedStep {
                id: "s1".into(),
                at_ms: 3,
                action: Action::SetValue { target: ElementRef::default(), value: String::new(), secret: true },
                screenshot: None,
            }],
        };
        let v = serde_json::to_value(&ep).unwrap();
        assert_eq!(v["startedAt"], 1);
        assert_eq!(v["steps"][0]["atMs"], 3);
        assert_eq!(v["steps"][0]["action"]["kind"], "setValue");
        assert_eq!(v["steps"][0]["action"]["secret"], true);
        assert_eq!(ep.id.len(), 16);
    }
}
