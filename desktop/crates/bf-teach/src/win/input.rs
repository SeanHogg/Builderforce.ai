//! The ONE global input hook. Windows allows a process one `rdev::listen` loop, and it
//! never returns, so it is started once and fans events out to whoever is subscribed —
//! the recorder (what the person does) and replay (the Esc takeover).
//!
//! Only events that matter leave this module: left clicks with their position and key
//! presses with the modifier state. Mouse movement is kept here, as the position of the
//! next click, and never forwarded.

use rdev::{Button, EventType, Key};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone)]
pub enum Input {
    Click { x: i32, y: i32 },
    Key { key: Key, text: Option<String>, ctrl: bool, alt: bool, shift: bool, meta: bool },
}

static SUBSCRIBERS: Mutex<Vec<Sender<Input>>> = Mutex::new(Vec::new());
static STARTED: OnceLock<()> = OnceLock::new();
/// Set while replay is injecting input, so the hook does not report the skill's own
/// keystrokes as the person's (an injected Esc must not stop the run).
static INJECTING: AtomicBool = AtomicBool::new(false);

pub fn subscribe() -> Receiver<Input> {
    STARTED.get_or_init(|| {
        let _ = std::thread::Builder::new().name("bf-input-hook".into()).spawn(listen);
    });
    let (tx, rx) = channel();
    SUBSCRIBERS.lock().unwrap().push(tx);
    rx
}

/// Run `f` with the hook ignoring input, for input replay generates itself.
pub fn injecting<T>(f: impl FnOnce() -> T) -> T {
    INJECTING.store(true, Ordering::SeqCst);
    let out = f();
    // SendInput is asynchronous: give the hook time to see (and drop) the last event.
    std::thread::sleep(std::time::Duration::from_millis(60));
    INJECTING.store(false, Ordering::SeqCst);
    out
}

fn publish(input: Input) {
    // A dropped receiver is a finished recording or run: forget it.
    SUBSCRIBERS.lock().unwrap().retain(|tx| tx.send(input.clone()).is_ok());
}

fn listen() {
    let (mut x, mut y) = (0.0f64, 0.0f64);
    let (mut ctrl, mut alt, mut shift, mut meta) = (false, false, false, false);
    let result = rdev::listen(move |event| {
        match event.event_type {
            EventType::MouseMove { x: mx, y: my } => {
                x = mx;
                y = my;
            }
            EventType::KeyPress(k) | EventType::KeyRelease(k) => {
                let down = matches!(event.event_type, EventType::KeyPress(_));
                match k {
                    Key::ControlLeft | Key::ControlRight => ctrl = down,
                    Key::Alt | Key::AltGr => alt = down,
                    Key::ShiftLeft | Key::ShiftRight => shift = down,
                    Key::MetaLeft | Key::MetaRight => meta = down,
                    _ if down && !INJECTING.load(Ordering::SeqCst) => {
                        publish(Input::Key { key: k, text: event.name.clone(), ctrl, alt, shift, meta });
                    }
                    _ => {}
                }
            }
            EventType::ButtonPress(Button::Left) if !INJECTING.load(Ordering::SeqCst) => {
                publish(Input::Click { x: x.round() as i32, y: y.round() as i32 });
            }
            _ => {}
        }
    });
    if let Err(e) = result {
        eprintln!("bf-teach: input hook failed: {e:?}");
    }
}
