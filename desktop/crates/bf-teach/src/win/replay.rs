//! Run a Train Once skill in the real program.
//!
//! Each step: wait for the program's window, find the element by accessibility identity
//! (retrying while the UI catches up), act through its pattern (Invoke, Value) and verify,
//! or — when the element cannot be found — act at its recorded position inside the window
//! and say so in the audit trail. Steps marked for approval wait for the person. Esc, or
//! Stop in the window, ends the run at once.

use super::input::{self, Input};
use super::procs::Scope;
use super::uia::{self, Uia, Window};
use super::err;
use crate::RunHooks;
use anyhow::{anyhow, Result};
use crate::model::{ElementRef, RunStatus, Skill, SkillAction, SkillValue, StepOutcome};
use enigo::{Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use rdev::Key as RKey;
use std::collections::{BTreeMap, HashSet};
use std::sync::mpsc::Receiver;
use std::time::{Duration, Instant};

const WINDOW_WAIT: Duration = Duration::from_secs(20);
const ELEMENT_WAIT: Duration = Duration::from_secs(5);
const SETTLE: Duration = Duration::from_millis(400);
const POLL: Duration = Duration::from_millis(250);

/// The person took control back (Esc) or pressed Stop.
struct Stop;

struct Runner<'a> {
    /// Secret parameter names: their values are never read back to verify.
    secrets: HashSet<String>,
    uia: Uia,
    enigo: Enigo,
    scope: Scope,
    esc: Receiver<Input>,
    hooks: &'a mut dyn RunHooks,
}

pub fn run_skill(skill: &Skill, values: &BTreeMap<String, String>, hooks: &mut dyn RunHooks) -> Result<RunStatus> {
    // Every parameter resolved up front: the value given, else the demonstration's. A
    // secret has no default, so a missing one stops the run before anything moves.
    let mut resolved = BTreeMap::new();
    for p in &skill.params {
        match values.get(&p.name).cloned().or_else(|| p.default.clone()) {
            Some(v) => {
                resolved.insert(p.name.clone(), v);
            }
            None => return Err(anyhow!("a value for “{}” is needed", p.label)),
        }
    }
    let values = &resolved;
    // Listen for Esc before anything moves, so the person can stop the very first step.
    let esc = input::subscribe();
    let child = std::process::Command::new(&skill.program)
        .args(&skill.args)
        .spawn()
        .map_err(|e| anyhow!("could not start {}: {e}", skill.program))?;
    let mut r = Runner {
        secrets: skill.params.iter().filter(|p| p.secret).map(|p| p.name.clone()).collect(),
        uia: Uia::new()?,
        enigo: Enigo::new(&Settings::default()).map_err(err)?,
        scope: Scope::new(child.id(), &skill.program),
        esc,
        hooks,
    };
    if r.wait_for(WINDOW_WAIT, |r| r.first_window().is_some()).is_err() {
        return Ok(RunStatus::Stopped);
    }
    for (idx, step) in skill.steps.iter().enumerate() {
        if r.interrupted().is_some() {
            return Ok(RunStatus::Stopped);
        }
        // The person closed the program mid-run: say so, instead of searching for
        // windows that no longer exist until a step times out.
        if !r.scope.root_alive() {
            return Err(anyhow!("{} was closed during the run", skill.program));
        }
        r.hooks.step_started(idx);
        if step.requires_approval {
            if !r.hooks.approve(idx) {
                r.hooks.step_finished(idx, StepOutcome::Denied, None);
                return Ok(RunStatus::Denied);
            }
            r.hooks.step_finished(idx, StepOutcome::Approved, None);
        }
        let (outcome, detail) = match r.perform(&step.action, values) {
            Ok(o) => o,
            Err(StepError::Stop(_)) => return Ok(RunStatus::Stopped),
            Err(StepError::Failed(msg)) => {
                r.hooks.step_finished(idx, StepOutcome::Failed, Some(msg.clone()));
                return Err(anyhow!(msg));
            }
        };
        r.hooks.step_finished(idx, outcome, detail);
        std::thread::sleep(SETTLE);
    }
    Ok(RunStatus::Succeeded)
}

enum StepError {
    Stop(Stop),
    Failed(String),
}

impl From<Stop> for StepError {
    fn from(s: Stop) -> Self {
        StepError::Stop(s)
    }
}

type StepResult = std::result::Result<(StepOutcome, Option<String>), StepError>;

impl Runner<'_> {
    /// Esc from the person (not our own injected input) or Stop from the window.
    fn interrupted(&mut self) -> Option<Stop> {
        while let Ok(ev) = self.esc.try_recv() {
            if matches!(ev, Input::Key { key: RKey::Escape, .. }) {
                return Some(Stop);
            }
        }
        self.hooks.should_stop().then_some(Stop)
    }

    /// Poll `ready` until it holds or `limit` passes, staying interruptible.
    fn wait_for(&mut self, limit: Duration, mut ready: impl FnMut(&mut Self) -> bool) -> std::result::Result<bool, Stop> {
        let deadline = Instant::now() + limit;
        loop {
            if let Some(s) = self.interrupted() {
                return Err(s);
            }
            if ready(self) {
                return Ok(true);
            }
            if Instant::now() >= deadline {
                return Ok(false);
            }
            std::thread::sleep(POLL);
        }
    }

    fn first_window(&mut self) -> Option<Window> {
        let pids = self.scope.pids();
        self.uia.windows_of(&pids).into_iter().next()
    }

    /// The window a step was recorded in: same title, else one containing it, else the
    /// program's first window.
    fn window_for(&mut self, target: &ElementRef) -> Option<Window> {
        let pids = self.scope.pids();
        let mut wins = self.uia.windows_of(&pids);
        let pick = wins
            .iter()
            .position(|w| w.title == target.window_title)
            .or_else(|| wins.iter().position(|w| !target.window_title.is_empty() && w.title.contains(&target.window_title)))
            .or(if wins.is_empty() { None } else { Some(0) })?;
        Some(wins.swap_remove(pick))
    }

    /// Find the step's element, retrying while the UI settles. Returns the window too,
    /// for the positional fallback.
    fn locate(&mut self, target: &ElementRef) -> std::result::Result<(Option<Window>, Option<uiautomation::UIElement>), Stop> {
        let mut found = (None, None);
        self.wait_for(ELEMENT_WAIT, |r| {
            let win = r.window_for(target);
            let el = win.as_ref().and_then(|w| r.uia.find(w, target));
            let done = el.is_some();
            found = (win, el);
            done
        })?;
        Ok(found)
    }

    fn perform(&mut self, action: &SkillAction, values: &BTreeMap<String, String>) -> StepResult {
        match action {
            SkillAction::Click { target } => {
                let (win, el) = self.locate(target)?;
                match (el, win) {
                    (Some(el), _) => {
                        if uia::invoke(&el) || el.click().is_ok() {
                            Ok((StepOutcome::Ok, None))
                        } else {
                            Err(StepError::Failed(format!("could not click “{}”", target.label())))
                        }
                    }
                    (None, Some(w)) => {
                        self.click_at(&w, target)?;
                        Ok((StepOutcome::Fallback, Some(format!("“{}” not found; clicked its recorded position", target.label()))))
                    }
                    (None, None) => Err(StepError::Failed(format!("the “{}” window is not open", target.window_title))),
                }
            }
            SkillAction::SetValue { target, value } => {
                let (text, secret) = match value {
                    SkillValue::Literal { text } => (text.clone(), false),
                    SkillValue::Param { name } => (values.get(name).cloned().unwrap_or_default(), self.secrets.contains(name)),
                };
                let (win, el) = self.locate(target)?;
                match (el, win) {
                    (Some(el), _) => {
                        if uia::set_value(&el, &text) {
                            // Password fields do not read back; every other value is checked.
                            if secret || uia::value(&el).is_some_and(|v| v == text) {
                                return Ok((StepOutcome::Ok, None));
                            }
                        }
                        let _ = el.set_focus();
                        self.replace_text(&text)?;
                        Ok((StepOutcome::Ok, Some("typed".into())))
                    }
                    (None, Some(w)) => {
                        self.click_at(&w, target)?;
                        self.replace_text(&text)?;
                        Ok((StepOutcome::Fallback, Some(format!("“{}” not found; typed at its recorded position", target.label()))))
                    }
                    (None, None) => Err(StepError::Failed(format!("the “{}” window is not open", target.window_title))),
                }
            }
            SkillAction::Keys { keys, target } => {
                if let Some(t) = target {
                    if let (_, Some(el)) = self.locate(t)? {
                        let _ = el.set_focus();
                    }
                }
                self.send_keys(keys)?;
                Ok((StepOutcome::Ok, None))
            }
        }
    }

    fn click_at(&mut self, w: &Window, target: &ElementRef) -> std::result::Result<(), StepError> {
        let (x, y) = (w.rect.get_left() + target.rel_x, w.rect.get_top() + target.rel_y);
        let enigo = &mut self.enigo;
        input::injecting(|| {
            enigo.move_mouse(x, y, Coordinate::Abs)?;
            enigo.button(Button::Left, Direction::Click)
        })
        .map_err(|e| StepError::Failed(format!("{e:?}")))
    }

    /// Select what is in the focused field and type over it.
    fn replace_text(&mut self, text: &str) -> std::result::Result<(), StepError> {
        let enigo = &mut self.enigo;
        input::injecting(|| {
            enigo.key(Key::Control, Direction::Press)?;
            enigo.key(Key::Unicode('a'), Direction::Click)?;
            enigo.key(Key::Control, Direction::Release)?;
            if text.is_empty() {
                enigo.key(Key::Delete, Direction::Click)
            } else {
                enigo.text(text)
            }
        })
        .map_err(|e| StepError::Failed(format!("{e:?}")))
    }

    fn send_keys(&mut self, combo: &str) -> std::result::Result<(), StepError> {
        let (mods, key) = parse_combo(combo).ok_or_else(|| StepError::Failed(format!("unknown key “{combo}”")))?;
        let enigo = &mut self.enigo;
        input::injecting(|| {
            for m in &mods {
                enigo.key(*m, Direction::Press)?;
            }
            let r = enigo.key(key, Direction::Click);
            for m in mods.iter().rev() {
                enigo.key(*m, Direction::Release)?;
            }
            r
        })
        .map_err(|e| StepError::Failed(format!("{e:?}")))
    }
}

/// `Ctrl+Shift+S` → ([Control, Shift], Unicode('s')).
fn parse_combo(combo: &str) -> Option<(Vec<Key>, Key)> {
    let mut parts: Vec<&str> = combo.split('+').collect();
    let last = parts.pop()?;
    let mods = parts
        .into_iter()
        .map(|m| match m {
            "Ctrl" => Some(Key::Control),
            "Alt" => Some(Key::Alt),
            "Shift" => Some(Key::Shift),
            "Win" => Some(Key::Meta),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    let key = match last {
        "Enter" => Key::Return,
        "Tab" => Key::Tab,
        "Escape" => Key::Escape,
        "Delete" => Key::Delete,
        "Up" => Key::UpArrow,
        "Down" => Key::DownArrow,
        "Left" => Key::LeftArrow,
        "Right" => Key::RightArrow,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        "Home" => Key::Home,
        "End" => Key::End,
        "Space" => Key::Space,
        f if f.starts_with('F') && f.len() > 1 => function_key(f[1..].parse().ok()?)?,
        c if c.chars().count() == 1 => Key::Unicode(c.chars().next()?.to_ascii_lowercase()),
        _ => return None,
    };
    Some((mods, key))
}

fn function_key(n: u8) -> Option<Key> {
    Some(match n {
        1 => Key::F1,
        2 => Key::F2,
        3 => Key::F3,
        4 => Key::F4,
        5 => Key::F5,
        6 => Key::F6,
        7 => Key::F7,
        8 => Key::F8,
        9 => Key::F9,
        10 => Key::F10,
        11 => Key::F11,
        12 => Key::F12,
        _ => return None,
    })
}
