//! Synapse signed in to builderforce.ai: the account (browser sign-in, the workspace in
//! use), and on top of it the chats and agents of that workspace. The client itself is
//! `bf-cloud`; this module holds the live state between it and the window — the session,
//! a sign-in in progress, the Brain's replies on their way — and the commands.

pub mod account;
mod brain;
mod brain_tools;
pub mod chat;
mod live;
pub mod remote_approval;
pub mod request;
pub mod starter_model;

use bf_cloud::{Account, CloudError, Session};
use live::Replies;
use std::path::Path;
use std::sync::Arc;

pub type Res<T> = Result<T, String>;

pub struct Cloud {
    /// Signed in or not, a sign-in in progress, the workspace in use — `bf-cloud`'s
    /// shared account, the same one Spawn holds.
    pub account: Arc<Account>,
    /// The Brain's replies on their way — streaming, using a tool, or waiting for the
    /// person's go-ahead — and why the last one in a chat failed.
    replies: Replies,
}

impl Cloud {
    /// Resume the saved sign-in, if there is one. Nothing touches the network here.
    pub fn open(dir: &Path) -> Arc<Self> {
        Arc::new(Self {
            account: Account::open(bf_cloud::SYNAPSE, dir),
            replies: Replies::default(),
        })
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
