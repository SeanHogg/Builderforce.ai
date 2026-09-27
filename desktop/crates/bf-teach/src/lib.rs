//! bf-teach — the hands and eyes of Self-Directed Agents.
//!
//! **Recording**: launch a program and capture what the person does in *its* windows as
//! semantic steps (the UI Automation element acted on, the value set, a screenshot) — not a
//! raw keystroke log. Password fields are redacted at capture.
//!
//! **Replay**: run a Train Once skill — find each element by accessibility identity, fall
//! back to its recorded position, verify values, pause for approval where the skill says
//! so, and stop the moment the person presses Esc.
//!
//! **Vault**: secret parameters live in the OS credential store and are used at replay
//! without ever being shown.
//!
//! Windows first. On other platforms every entry point reports that it is not supported
//! yet, so the app builds and runs there with these features switched off.

pub mod model;

pub use model::StepOutcome;

/// What a run tells its owner as it goes, and asks it.
pub trait RunHooks {
    fn step_started(&mut self, idx: usize);
    fn step_finished(&mut self, idx: usize, outcome: StepOutcome, detail: Option<String>);
    /// Block until the person approves (true) or declines (false) step `idx`.
    fn approve(&mut self, idx: usize) -> bool;
    /// The person pressed Stop in the window.
    fn should_stop(&self) -> bool;
}

/// The key a person presses to take control back from a running skill.
pub const TAKEOVER_KEY: &str = "Esc";

#[cfg(windows)]
mod win;
#[cfg(windows)]
pub use win::{recording::start_recording, recording::Recording, replay::run_skill};

#[cfg(not(windows))]
mod other;
#[cfg(not(windows))]
pub use other::{run_skill, start_recording, Recording};

/// Whether recording and replay work on this OS.
pub fn supported() -> bool {
    cfg!(windows)
}
