//! Synapse signed in to builderforce.ai: the account (browser sign-in, the workspace in
//! use), and on top of it the chats and agents of that workspace. The client itself is
//! `bf-cloud`; this module holds the live state between it and the window — the session,
//! a sign-in in progress, the chats with a Brain reply on its way — and the commands.

pub mod account;
mod brain;
pub mod chat;
pub mod request;

use bf_cloud::{Account, CloudError, Session};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};

pub type Res<T> = Result<T, String>;

pub struct Cloud {
    /// Signed in or not, a sign-in in progress, the workspace in use — `bf-cloud`'s
    /// shared account, the same one Spawn holds.
    pub account: Arc<Account>,
    /// Chats with a Brain reply on its way, and why the last one failed (kept here, not
    /// written into the shared transcript).
    replying: Mutex<HashSet<i64>>,
    reply_errors: Mutex<HashMap<i64, String>>,
}

impl Cloud {
    /// Resume the saved sign-in, if there is one. Nothing touches the network here.
    pub fn open(dir: &Path) -> Arc<Self> {
        Arc::new(Self {
            account: Account::open(bf_cloud::SYNAPSE, dir),
            replying: Mutex::new(HashSet::new()),
            reply_errors: Mutex::new(HashMap::new()),
        })
    }

    pub fn session(&self) -> Option<Arc<Session>> {
        self.account.session()
    }

    /// The session, or "not signed in".
    pub fn require(&self) -> Res<Arc<Session>> {
        self.account.require()
    }

    /// A platform error as the window sees it; a refused key also signs out.
    pub fn fail(&self, err: CloudError) -> String {
        self.account.fail(err)
    }
}
