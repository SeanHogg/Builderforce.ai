//! One skill runs at a time — replay drives the real mouse and keyboard, so two at once
//! would fight. The coordinator owns that run: it starts it on its own thread, writes the
//! audit trail to the Evermind store as steps finish, and holds the approval handshake —
//! the run blocks on `approve`, the window answers with `decide`.

use bf_memory::MemoryClient;
use bf_teach::model::{now_ms, RunStatus, Skill, SkillAction, StepOutcome};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Told `(skill name, run id)` when a step needs approval.
type ApprovalHook = Box<dyn Fn(&str, &str) + Send + Sync>;

/// An approval nobody answers is a no: a run never proceeds past a gate unattended.
pub const APPROVAL_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// How often a relayed approval is checked for an answer given elsewhere.
const RELAY_POLL: Duration = Duration::from_secs(3);

/// Somewhere else a step's approval can be answered — the person's phone, through their
/// Builderforce account. The window's Approve and the relay race; the first answer wins
/// and the other side is told.
pub trait ApprovalRelay: Send + Sync {
    /// Open a request; `None` when nothing is relayed (switched off, signed out, offline).
    fn open(&self, skill: &str, run_id: &str, step: usize, action: Option<&SkillAction>) -> Option<String>;
    /// The answer given elsewhere, once there is one.
    fn answer(&self, id: &str) -> Option<bool>;
    /// Close the request with the decision taken here (a timeout is a no).
    fn close(&self, id: &str, approved: bool);
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveRun {
    pub run_id: String,
    pub skill_id: String,
    pub skill_name: String,
    /// `manual` or `routine` — what started it.
    pub trigger: String,
    pub current: Option<usize>,
    /// The step waiting for the person's approval, and what it will do.
    pub pending_approval: Option<usize>,
    pub pending_action: Option<SkillAction>,
}

#[derive(Default)]
struct Inner {
    active: Option<ActiveRun>,
    stop: bool,
    decision: Option<bool>,
}

#[derive(Deserialize)]
struct RunRef {
    id: String,
    #[serde(default)]
    status: String,
}

pub struct Runs {
    mem: Arc<MemoryClient>,
    inner: Mutex<Inner>,
    cv: Condvar,
    /// Called when a step needs approval — the app brings the window forward and notifies.
    on_approval: ApprovalHook,
    relay: OnceLock<Arc<dyn ApprovalRelay>>,
}

impl Runs {
    pub fn new(mem: Arc<MemoryClient>, on_approval: impl Fn(&str, &str) + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self { mem, inner: Mutex::new(Inner::default()), cv: Condvar::new(), on_approval: Box::new(on_approval), relay: OnceLock::new() })
    }

    /// Let approvals also be answered through `relay` (set once, at start).
    pub fn set_relay(&self, relay: Arc<dyn ApprovalRelay>) {
        let _ = self.relay.set(relay);
    }

    pub fn active(&self) -> Option<ActiveRun> {
        self.inner.lock().unwrap().active.clone()
    }

    /// Runs a previous session left `running` (Synapse closed mid-run) are closed as failed,
    /// so the audit trail never shows a run that is not happening.
    pub fn close_orphaned(&self) {
        let Ok(runs) = self.mem.call_as::<Vec<RunRef>>("run_list", json!({ "limit": 500 })) else { return };
        for r in runs.into_iter().filter(|r| r.status == RunStatus::Running.as_str()) {
            let _ = self.mem.call("run_finish", json!({ "runId": r.id, "status": "failed", "error": "Synapse closed during the run" }));
        }
    }

    /// Start `skill`. Fails if another run is going.
    pub fn start(self: &Arc<Self>, skill: Skill, values: BTreeMap<String, String>, trigger: &str) -> anyhow::Result<String> {
        let mut inner = self.inner.lock().unwrap();
        if inner.active.is_some() {
            anyhow::bail!("another skill is running");
        }
        let run: RunRef = self.mem.call_as("run_start", json!({ "skillId": skill.id, "trigger": trigger }))?;
        inner.active = Some(ActiveRun {
            run_id: run.id.clone(),
            skill_id: skill.id.clone(),
            skill_name: skill.name.clone(),
            trigger: trigger.to_string(),
            current: None,
            pending_approval: None,
            pending_action: None,
        });
        inner.stop = false;
        inner.decision = None;
        drop(inner);
        let me = self.clone();
        let run_id = run.id.clone();
        let trigger = trigger.to_string();
        std::thread::Builder::new().name("synapse-run".into()).spawn(move || {
            let mut hooks = Hooks { runs: &me, run_id: &run_id, skill: &skill };
            let (status, error) = match bf_teach::run_skill(&skill, &values, &mut hooks) {
                Ok(s) => (s, None),
                Err(e) => (RunStatus::Failed, Some(format!("{e:#}"))),
            };
            let _ = me.mem.call("run_finish", json!({ "runId": run_id, "status": status.as_str(), "error": error }));
            // A fact every AI tool on the machine can recall: what Synapse last did.
            let _ = me.mem.call(
                "memory_remember",
                json!({
                    "key": format!("synapse.skill.{}.last-run", skill.id),
                    "content": format!("Synapse ran the skill \"{}\" ({trigger}) at {} (epoch ms): {}.", skill.name, now_ms(), status.as_str()),
                    "tags": ["synapse", "skill-run"],
                }),
            );
            me.inner.lock().unwrap().active = None;
            me.cv.notify_all();
        })?;
        Ok(run.id)
    }

    /// Stop the running skill (the Stop button; Esc is handled inside the run).
    pub fn stop(&self) {
        self.inner.lock().unwrap().stop = true;
        self.cv.notify_all();
    }

    /// Answer the pending approval.
    pub fn decide(&self, approve: bool) {
        let mut inner = self.inner.lock().unwrap();
        if inner.active.as_ref().is_some_and(|a| a.pending_approval.is_some()) {
            inner.decision = Some(approve);
            self.cv.notify_all();
        }
    }
}

struct Hooks<'a> {
    runs: &'a Runs,
    run_id: &'a str,
    skill: &'a Skill,
}

impl bf_teach::RunHooks for Hooks<'_> {
    fn step_started(&mut self, idx: usize) {
        if let Some(a) = self.runs.inner.lock().unwrap().active.as_mut() {
            a.current = Some(idx);
        }
    }

    fn step_finished(&mut self, idx: usize, outcome: StepOutcome, detail: Option<String>) {
        let step_id = self.skill.steps.get(idx).map(|s| s.id.as_str()).unwrap_or("");
        let _ = self.runs.mem.call(
            "run_step",
            json!({ "runId": self.run_id, "idx": idx, "stepId": step_id, "outcome": outcome.as_str(), "detail": detail }),
        );
    }

    fn approve(&mut self, idx: usize) -> bool {
        let action = self.skill.steps.get(idx).map(|s| s.action.clone());
        {
            let mut inner = self.runs.inner.lock().unwrap();
            inner.decision = None;
            if let Some(a) = inner.active.as_mut() {
                a.pending_approval = Some(idx);
                a.pending_action = action.clone();
            }
        }
        (self.runs.on_approval)(&self.skill.name, self.run_id);
        let relay = self.runs.relay.get().cloned();
        let remote = relay.as_ref().and_then(|r| r.open(&self.skill.name, self.run_id, idx, action.as_ref()));
        let deadline = Instant::now() + APPROVAL_TIMEOUT;
        let mut answered_elsewhere = None;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let slice = if remote.is_some() { left.min(RELAY_POLL) } else { left };
            let inner = self.runs.inner.lock().unwrap();
            let (inner, _) = self.runs.cv.wait_timeout_while(inner, slice, |i| i.decision.is_none() && !i.stop).unwrap();
            if inner.decision.is_some() || inner.stop || Instant::now() >= deadline {
                break;
            }
            drop(inner);
            // Never ask the network while holding the lock the window answers through.
            if let (Some(r), Some(id)) = (&relay, &remote) {
                if let Some(a) = r.answer(id) {
                    answered_elsewhere = Some(a);
                    break;
                }
            }
        }
        let mut inner = self.runs.inner.lock().unwrap();
        let here = inner.decision.take();
        let approved = answered_elsewhere.or(here).unwrap_or(false) && !inner.stop;
        if let Some(a) = inner.active.as_mut() {
            a.pending_approval = None;
            a.pending_action = None;
        }
        drop(inner);
        if let (Some(r), Some(id), None) = (&relay, &remote, answered_elsewhere) {
            r.close(id, approved);
        }
        approved
    }

    fn should_stop(&self) -> bool {
        self.runs.inner.lock().unwrap().stop
    }
}
