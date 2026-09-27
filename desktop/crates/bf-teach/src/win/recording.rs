//! Record what the person does in the program the app launched, as semantic steps.
//!
//! A click becomes "clicked <element>". Typing becomes one "set <field> to <value>" when
//! the person moves on — the value read back from the field itself, so a typo and its
//! correction record as the final text. Enter, Tab, arrows and shortcuts are steps of
//! their own. Password fields record that they were filled, never what with. Input to any
//! other program, including Synapse itself, is ignored.

use super::input::{self, Input};
use super::procs::Scope;
use super::{shot, uia};
use anyhow::{anyhow, Result};
use crate::model::{new_id, Action, ElementRef, RecordedStep};
use rdev::Key;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use uiautomation::UIElement;

pub struct Recording {
    stop: Arc<AtomicBool>,
    steps: Arc<Mutex<Vec<RecordedStep>>>,
    error: Arc<Mutex<Option<String>>>,
    handle: Option<JoinHandle<()>>,
}

impl Recording {
    /// The steps so far (the window shows them live).
    pub fn steps(&self) -> Vec<RecordedStep> {
        self.steps.lock().unwrap().clone()
    }

    /// Why recording ended early, if it did (the program could not start, for one).
    pub fn error(&self) -> Option<String> {
        self.error.lock().unwrap().clone()
    }

    pub fn is_running(&self) -> bool {
        self.handle.as_ref().is_some_and(|h| !h.is_finished())
    }

    /// Stop and return every step, with any half-typed value flushed.
    pub fn stop(mut self) -> Vec<RecordedStep> {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
        self.steps()
    }
}

impl Drop for Recording {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

/// Launch `program` and start recording it. Screenshots go into `shots_dir`.
pub fn start_recording(program: &str, args: &[String], shots_dir: &Path) -> Result<Recording> {
    if !Path::new(program).exists() {
        return Err(anyhow!("{program} was not found"));
    }
    let child = std::process::Command::new(program).args(args).spawn().map_err(|e| anyhow!("could not start {program}: {e}"))?;
    let stop = Arc::new(AtomicBool::new(false));
    let steps = Arc::new(Mutex::new(Vec::new()));
    let error = Arc::new(Mutex::new(None));
    // Subscribe before the thread starts so no early click is missed.
    let rx = input::subscribe();
    let ctx = Ctx { program: program.to_string(), root_pid: child.id(), shots: shots_dir.to_path_buf(), steps: steps.clone() };
    let (stop_t, error_t) = (stop.clone(), error.clone());
    let handle = std::thread::Builder::new().name("bf-teach-record".into()).spawn(move || {
        if let Err(e) = record_loop(ctx, rx, &stop_t) {
            *error_t.lock().unwrap() = Some(format!("{e:#}"));
        }
    })?;
    Ok(Recording { stop, steps, error, handle: Some(handle) })
}

struct Ctx {
    program: String,
    root_pid: u32,
    shots: PathBuf,
    steps: Arc<Mutex<Vec<RecordedStep>>>,
}

/// A field being typed into, flushed as one SetValue when the person moves on.
struct Typing {
    element: UIElement,
    target: ElementRef,
    buffer: String,
    secret: bool,
    at: (i32, i32),
}

fn record_loop(ctx: Ctx, rx: std::sync::mpsc::Receiver<Input>, stop: &AtomicBool) -> Result<()> {
    let uia = uia::Uia::new()?;
    let mut scope = Scope::new(ctx.root_pid, &ctx.program);
    let started = Instant::now();
    let mut typing: Option<Typing> = None;
    let mut push = |action: Action, at: (i32, i32)| {
        let id = new_id();
        let screenshot = shot::capture(at.0, at.1, &ctx.shots, &id).ok();
        ctx.steps.lock().unwrap().push(RecordedStep { id, at_ms: started.elapsed().as_millis() as u64, action, screenshot });
    };

    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let event = match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(e) => e,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };
        match event {
            Input::Click { x, y } => {
                let Some(el) = uia.at(x, y) else { continue };
                let Some(pid) = uia::pid(&el).filter(|p| scope.contains(*p)) else { continue };
                if let Some(t) = typing.take() {
                    flush(t, &mut push);
                }
                let target = uia.describe(&el, Some((x, y)), &scope.name(pid));
                push(Action::Click { target }, (x, y));
            }
            Input::Key { key, text, ctrl, alt, shift, meta } => {
                let Some(el) = uia.focused() else { continue };
                let Some(pid) = uia::pid(&el).filter(|p| scope.contains(*p)) else { continue };
                // Focus moved to another field: the previous one is done.
                if typing.as_ref().is_some_and(|t| !uia::same(&t.element, &el, &uia)) {
                    flush(typing.take().expect("checked"), &mut push);
                }
                let secret = uia::is_password(&el);
                let printable = text.as_deref().filter(|s| !s.is_empty() && s.chars().all(|c| !c.is_control()));
                if let (Some(s), false, false, false) = (printable, ctrl, alt, meta) {
                    let t = typing.get_or_insert_with(|| {
                        let at = uia::centre(&el);
                        Typing { target: uia.describe(&el, None, &scope.name(pid)), element: el.clone(), buffer: String::new(), secret, at }
                    });
                    // A password's characters never reach memory, let alone disk.
                    if !t.secret {
                        t.buffer.push_str(s);
                    }
                    continue;
                }
                if key == Key::Backspace {
                    if let Some(t) = typing.as_mut() {
                        t.buffer.pop();
                    }
                    continue;
                }
                let Some(label) = key_label(key, ctrl, alt, shift, meta) else { continue };
                if let Some(t) = typing.take() {
                    flush(t, &mut push);
                }
                let at = uia::centre(&el);
                let target = uia.describe(&el, None, &scope.name(pid));
                push(Action::Keys { keys: label, target: Some(target) }, at);
            }
        }
    }
    if let Some(t) = typing.take() {
        flush(t, &mut push);
    }
    Ok(())
}

fn flush(t: Typing, push: &mut impl FnMut(Action, (i32, i32))) {
    let value = if t.secret {
        String::new()
    } else {
        // The field's own value is the truth (autocomplete, a corrected typo, a mask);
        // what was typed is the fallback for fields that expose none.
        uia::value(&t.element).filter(|v| !v.is_empty()).unwrap_or(t.buffer)
    };
    push(Action::SetValue { target: t.target, value, secret: t.secret }, t.at);
}

/// `Enter`, `Ctrl+S`, `Alt+F4` — the keys that are actions rather than text. None for a
/// key that is neither (a lone modifier, a key with no name).
pub fn key_label(key: Key, ctrl: bool, alt: bool, shift: bool, meta: bool) -> Option<String> {
    let name = match key {
        Key::Return | Key::KpReturn => "Enter".to_string(),
        Key::Tab => "Tab".into(),
        Key::Escape => "Escape".into(),
        Key::Delete => "Delete".into(),
        Key::UpArrow => "Up".into(),
        Key::DownArrow => "Down".into(),
        Key::LeftArrow => "Left".into(),
        Key::RightArrow => "Right".into(),
        Key::PageUp => "PageUp".into(),
        Key::PageDown => "PageDown".into(),
        Key::Home => "Home".into(),
        Key::End => "End".into(),
        Key::Space => "Space".into(),
        other => {
            let dbg = format!("{other:?}");
            if let Some(letter) = dbg.strip_prefix("Key").filter(|l| l.len() == 1) {
                letter.to_string()
            } else if let Some(digit) = dbg.strip_prefix("Num").filter(|d| d.len() == 1) {
                digit.to_string()
            } else if dbg.starts_with('F') && dbg[1..].parse::<u8>().is_ok() {
                dbg
            } else {
                return None;
            }
        }
    };
    let is_plain_char = name.chars().count() == 1 || name == "Space";
    // A plain letter without a shortcut modifier is typing, handled as text.
    if is_plain_char && !ctrl && !alt && !meta {
        return None;
    }
    let mut parts = Vec::new();
    if ctrl {
        parts.push("Ctrl");
    }
    if alt {
        parts.push("Alt");
    }
    if shift {
        parts.push("Shift");
    }
    if meta {
        parts.push("Win");
    }
    parts.push(&name);
    Some(parts.join("+"))
}
