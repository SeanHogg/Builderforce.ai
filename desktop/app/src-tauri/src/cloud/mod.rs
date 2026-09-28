//! Synapse signed in to builderforce.ai: the account (browser sign-in, the workspace in
//! use), and on top of it the chats and agents of that workspace. The client itself is
//! `bf-cloud`; this module holds the live state between it and the window — the session,
//! a sign-in in progress, the chats with a Brain reply on its way — and the commands.

pub mod account;
mod brain;
pub mod chat;
pub mod request;

use bf_cloud::{CloudError, Session};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub type Res<T> = Result<T, String>;

/// A browser sign-in in progress, as the window shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum SignIn {
    Idle,
    Waiting { user_code: String, verification_uri: String },
    Failed { reason: String },
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountFile {
    workspace_id: Option<i64>,
}

pub struct Cloud {
    session: Mutex<Option<Arc<Session>>>,
    sign_in: Mutex<SignIn>,
    /// Bumped by each new sign-in and by cancel, so an abandoned poll loop stops.
    attempt: Mutex<u64>,
    /// Set when the platform refused the saved key — the window says why it signed out.
    expired: Mutex<bool>,
    /// Chats with a Brain reply on its way, and why the last one failed (kept here, not
    /// written into the shared transcript).
    replying: Mutex<HashSet<i64>>,
    reply_errors: Mutex<HashMap<i64, String>>,
    file: PathBuf,
}

impl Cloud {
    /// Resume the saved sign-in, if there is one. Nothing touches the network here.
    pub fn open(dir: &Path) -> Arc<Self> {
        let file = dir.join("account.json");
        let saved: AccountFile = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let session = bf_cloud::saved_key().map(|k| Arc::new(Session::new(k, saved.workspace_id)));
        Arc::new(Self {
            session: Mutex::new(session),
            sign_in: Mutex::new(SignIn::Idle),
            attempt: Mutex::new(0),
            expired: Mutex::new(false),
            replying: Mutex::new(HashSet::new()),
            reply_errors: Mutex::new(HashMap::new()),
            file,
        })
    }

    pub fn session(&self) -> Option<Arc<Session>> {
        self.session.lock().unwrap().clone()
    }

    /// The session, or "not signed in".
    pub fn require(&self) -> Res<Arc<Session>> {
        self.session().ok_or_else(|| CloudError::SignedOut.to_string())
    }

    fn remember_workspace(&self, id: Option<i64>) {
        let text = serde_json::to_string_pretty(&AccountFile { workspace_id: id }).unwrap_or_default();
        let _ = std::fs::write(&self.file, text);
    }

    /// Adopt a freshly minted key.
    fn signed_in(&self, key: String) {
        let _ = bf_cloud::save_key(&key);
        self.remember_workspace(None);
        *self.session.lock().unwrap() = Some(Arc::new(Session::new(key, None)));
        *self.expired.lock().unwrap() = false;
        *self.sign_in.lock().unwrap() = SignIn::Idle;
    }

    /// The platform refused the key: forget it here (it is already dead there).
    fn expire(&self) {
        bf_vault::delete(bf_cloud::KEY_ENTRY);
        *self.session.lock().unwrap() = None;
        *self.expired.lock().unwrap() = true;
    }

    /// A platform error as the window sees it; a refused key also signs out.
    pub fn fail(&self, err: CloudError) -> String {
        if matches!(err, CloudError::KeyRejected) {
            self.expire();
        }
        err.to_string()
    }
}
