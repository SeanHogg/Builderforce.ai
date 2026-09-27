//! What the service has been asked, by whom — the desktop window's "Recent activity".
//!
//! In memory only and bounded: it answers "is Claude Code actually using the index, and
//! what did it look for?", not an audit trail. Only the calls a person would recognise
//! as work are kept (a search, a map, a memory check, a workspace registration); health
//! probes and the window's own polling would drown them out.

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const CAPACITY: usize = 200;
const MAX_DETAIL_CHARS: usize = 160;
const MAX_CLIENT_CHARS: usize = 32;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Unix epoch milliseconds.
    pub at: u64,
    /// Who asked: `vscode`, `mcp`, `cli`, or whatever a client names itself.
    pub client: String,
    pub op: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root: Option<String>,
    /// The query, focus or text count — what the call was about.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Results returned (search hits, stale references found).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
    pub ms: u64,
    pub ok: bool,
}

#[derive(Default)]
pub struct Activity {
    entries: Mutex<VecDeque<Entry>>,
}

impl Activity {
    pub fn record(&self, mut entry: Entry) {
        entry.client = normalize_client(&entry.client);
        entry.detail = entry.detail.map(|d| truncate(&d, MAX_DETAIL_CHARS));
        let mut q = self.entries.lock().unwrap();
        if q.len() == CAPACITY {
            q.pop_front();
        }
        q.push_back(entry);
    }

    /// Newest first.
    pub fn recent(&self, limit: usize) -> Vec<Entry> {
        self.entries.lock().unwrap().iter().rev().take(limit).cloned().collect()
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// A client label is display text from outside the process: keep it short and plain.
fn normalize_client(raw: &str) -> String {
    let s: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(MAX_CLIENT_CHARS)
        .collect::<String>()
        .to_ascii_lowercase();
    if s.is_empty() { "unknown".into() } else { s }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max - 1).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(client: &str, op: &str) -> Entry {
        Entry { at: 0, client: client.into(), op: op.into(), root: None, detail: None, count: None, ms: 0, ok: true }
    }

    #[test]
    fn keeps_newest_first_and_stays_bounded() {
        let a = Activity::default();
        for i in 0..(CAPACITY + 5) {
            a.record(entry("mcp", &format!("op{i}")));
        }
        let recent = a.recent(CAPACITY + 10);
        assert_eq!(recent.len(), CAPACITY);
        assert_eq!(recent[0].op, format!("op{}", CAPACITY + 4));
    }

    #[test]
    fn client_labels_are_sanitized() {
        let a = Activity::default();
        a.record(entry("Claude Code<script>", "search"));
        a.record(entry("", "search"));
        let r = a.recent(2);
        assert_eq!(r[1].client, "claudecodescript");
        assert_eq!(r[0].client, "unknown");
    }
}
