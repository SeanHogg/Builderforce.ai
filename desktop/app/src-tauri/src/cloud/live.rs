//! The Brain's replies while they are being written: per chat, the answer so far, the tool
//! it is using, and a tool that changes something waiting for the person's go-ahead. The
//! window reads it on every transcript load and is told of each change as it happens
//! ([`super::brain`] emits it), so the reply streams in rather than appearing whole.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveReply {
    /// What the Brain has written so far.
    pub draft: String,
    /// The tool it is running now, by its readable name.
    pub activity: Option<String>,
    pub pending: Option<PendingTool>,
}

/// A tool that changes something, held until the person approves or denies it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingTool {
    pub id: u64,
    pub label: String,
    /// The arguments the Brain chose, as it wrote them.
    pub arguments: String,
}

#[derive(Default)]
pub struct Replies {
    live: Mutex<HashMap<i64, LiveReply>>,
    /// Why the last reply in a chat failed (kept here, not written into the shared transcript).
    errors: Mutex<HashMap<i64, String>>,
    /// The person's answer to a pending tool: chat → (tool id, approved).
    decisions: Mutex<HashMap<i64, (u64, bool)>>,
    decided: Condvar,
    next_id: AtomicU64,
}

impl Replies {
    /// Start a reply in `chat`; `false` when one is already on its way there.
    pub fn begin(&self, chat: i64) -> bool {
        let mut live = self.live.lock().unwrap();
        if live.contains_key(&chat) {
            return false;
        }
        live.insert(chat, LiveReply::default());
        self.errors.lock().unwrap().remove(&chat);
        true
    }

    pub fn end(&self, chat: i64, error: Option<String>) {
        self.live.lock().unwrap().remove(&chat);
        self.decisions.lock().unwrap().remove(&chat);
        if let Some(e) = error {
            self.errors.lock().unwrap().insert(chat, e);
        }
    }

    pub fn get(&self, chat: i64) -> Option<LiveReply> {
        self.live.lock().unwrap().get(&chat).cloned()
    }

    pub fn error(&self, chat: i64) -> Option<String> {
        self.errors.lock().unwrap().get(&chat).cloned()
    }

    /// Change the reply in `chat`; the result is what the window is told.
    pub fn update(&self, chat: i64, f: impl FnOnce(&mut LiveReply)) -> Option<LiveReply> {
        let mut live = self.live.lock().unwrap();
        let reply = live.get_mut(&chat)?;
        f(reply);
        Some(reply.clone())
    }

    /// Hold `label` in `chat` for the person's answer, up to `wait`. Silence is a no.
    /// `shown` is called once the question is up, to tell the window.
    pub fn ask(&self, chat: i64, label: String, arguments: String, wait: Duration, shown: impl FnOnce(Option<LiveReply>)) -> bool {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        shown(self.update(chat, |r| r.pending = Some(PendingTool { id, label, arguments })));
        let deadline = Instant::now() + wait;
        let mut decisions = self.decisions.lock().unwrap();
        let approved = loop {
            if let Some(&(for_id, approved)) = decisions.get(&chat) {
                if for_id == id {
                    decisions.remove(&chat);
                    break approved;
                }
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                break false;
            }
            decisions = self.decided.wait_timeout(decisions, left).unwrap().0;
        };
        drop(decisions);
        self.update(chat, |r| r.pending = None);
        approved
    }

    /// The person's answer to the tool waiting in `chat`. `false` when nothing is waiting.
    pub fn decide(&self, chat: i64, approve: bool) -> bool {
        let Some(id) = self.get(chat).and_then(|r| r.pending).map(|p| p.id) else { return false };
        self.decisions.lock().unwrap().insert(chat, (id, approve));
        self.decided.notify_all();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn one_reply_per_chat_and_its_error_outlives_it() {
        let r = Replies::default();
        assert!(r.begin(1));
        assert!(!r.begin(1));
        r.update(1, |l| l.draft.push_str("hi"));
        assert_eq!(r.get(1).unwrap().draft, "hi");
        r.end(1, Some("offline".into()));
        assert!(r.get(1).is_none());
        assert_eq!(r.error(1).as_deref(), Some("offline"));
        assert!(r.begin(1));
        assert!(r.error(1).is_none());
    }

    #[test]
    fn a_pending_tool_waits_for_the_answer_and_silence_is_a_no() {
        let r = Arc::new(Replies::default());
        r.begin(7);
        assert!(!r.decide(7, true), "nothing is waiting yet");
        let asker = r.clone();
        let waiting = std::thread::spawn(move || asker.ask(7, "tasks create".into(), "{}".into(), Duration::from_secs(10), |_| {}));
        while r.get(7).and_then(|l| l.pending).is_none() {
            std::thread::yield_now();
        }
        assert!(r.decide(7, true));
        assert!(waiting.join().unwrap());
        assert!(r.get(7).unwrap().pending.is_none());
        assert!(!r.ask(7, "tasks delete".into(), "{}".into(), Duration::from_millis(20), |_| {}));
    }
}
