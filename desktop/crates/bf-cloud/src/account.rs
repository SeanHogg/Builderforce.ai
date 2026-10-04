//! An app's signed-in state, as its window shows it: the session (resumed from the
//! credential store), a browser sign-in in progress, whether the platform refused the
//! saved key, and the workspace in use (remembered in the app's data directory).
//!
//! Framework-free on purpose — Synapse and Spawn both hold one and wrap it in their own
//! window commands. The only UI-shaped step, opening the approval page, is the caller's:
//! [`Account::begin_sign_in`] returns the URL and the caller opens it however its shell
//! opens links.

use crate::device::{self, DevicePoll, DeviceStart};
use crate::{AppIdentity, CloudError, Session};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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

pub struct Account {
    app: AppIdentity,
    session: Mutex<Option<Arc<Session>>>,
    sign_in: Mutex<SignIn>,
    /// Bumped by each new sign-in and by cancel, so an abandoned poll loop stops.
    attempt: Mutex<u64>,
    /// Set when the platform refused the saved key — the window says why it signed out.
    expired: Mutex<bool>,
    file: PathBuf,
}

impl Account {
    /// Resume the app's saved sign-in, if there is one. Nothing touches the network here.
    pub fn open(app: AppIdentity, dir: &Path) -> Arc<Self> {
        let file = dir.join("account.json");
        let saved: AccountFile = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        let session = crate::saved_key(&app).map(|k| Arc::new(Session::new(k, saved.workspace_id)));
        Arc::new(Self {
            app,
            session: Mutex::new(session),
            sign_in: Mutex::new(SignIn::Idle),
            attempt: Mutex::new(0),
            expired: Mutex::new(false),
            file,
        })
    }

    pub fn session(&self) -> Option<Arc<Session>> {
        self.session.lock().unwrap().clone()
    }

    /// The session, or "not signed in".
    pub fn require(&self) -> Result<Arc<Session>, String> {
        self.session().ok_or_else(|| CloudError::SignedOut.to_string())
    }

    /// A platform error as the window sees it; a refused key also signs out.
    pub fn fail(&self, err: CloudError) -> String {
        if matches!(err, CloudError::KeyRejected) {
            self.expire();
        }
        err.to_string()
    }

    fn remember_workspace(&self, id: Option<i64>) {
        let text = serde_json::to_string_pretty(&AccountFile { workspace_id: id }).unwrap_or_default();
        let _ = std::fs::write(&self.file, text);
    }

    /// Adopt a freshly minted key.
    fn signed_in(&self, key: String) {
        let _ = crate::save_key(&self.app, &key);
        self.remember_workspace(None);
        *self.session.lock().unwrap() = Some(Arc::new(Session::new(key, None)));
        *self.expired.lock().unwrap() = false;
        *self.sign_in.lock().unwrap() = SignIn::Idle;
    }

    /// The platform refused the key: forget it here (it is already dead there).
    fn expire(&self) {
        crate::forget_key(&self.app);
        *self.session.lock().unwrap() = None;
        *self.expired.lock().unwrap() = true;
    }

    /// Signed in or not, a sign-in in progress, and the workspace in use. Checking the
    /// workspace makes one exchange with the platform (cached for the token's lifetime),
    /// so a key revoked elsewhere is noticed here and signs out.
    pub fn state(&self) -> Value {
        let sign_in = self.sign_in.lock().unwrap().clone();
        let web = crate::web_base();
        let Some(s) = self.session() else {
            let expired = *self.expired.lock().unwrap();
            return json!({ "signedIn": false, "signIn": sign_in, "expired": expired, "web": web });
        };
        let (workspace_id, reachable, error) = match s.who() {
            Ok((id, _)) => (Some(id), true, None),
            Err(CloudError::KeyRejected) => {
                self.fail(CloudError::KeyRejected);
                return json!({ "signedIn": false, "signIn": sign_in, "expired": true, "web": web });
            }
            Err(e) => (s.workspace(), false, Some(e.to_string())),
        };
        json!({
            "signedIn": true,
            "signIn": sign_in,
            "workspaceId": workspace_id,
            "reachable": reachable,
            "error": error,
            "web": web,
        })
    }

    /// Start a browser sign-in: ask for a code pair, then poll on a thread until the
    /// person approves (or denies, or it expires). Returns the start at once — the caller
    /// opens `verification_uri_complete`; [`Account::state`] shows progress.
    pub fn begin_sign_in(self: &Arc<Self>) -> Result<DeviceStart, CloudError> {
        let start = device::start(&self.app)?;
        let attempt = {
            let mut a = self.attempt.lock().unwrap();
            *a += 1;
            *a
        };
        *self.sign_in.lock().unwrap() = SignIn::Waiting {
            user_code: start.user_code.clone(),
            verification_uri: start.verification_uri_complete.clone(),
        };

        let account = Arc::clone(self);
        let poll = start.clone();
        std::thread::Builder::new()
            .name(format!("{}-sign-in", self.app.name.to_ascii_lowercase()))
            .spawn(move || account.poll_until_done(&poll, attempt))
            .map_err(|e| CloudError::Unreachable(e.to_string()))?;
        Ok(start)
    }

    fn poll_until_done(&self, start: &DeviceStart, attempt: u64) {
        let deadline = Instant::now() + Duration::from_secs(start.expires_in);
        let mut wait = Duration::from_secs(start.interval.max(1));
        let failed = |reason: &str| *self.sign_in.lock().unwrap() = SignIn::Failed { reason: reason.into() };
        while Instant::now() < deadline {
            std::thread::sleep(wait);
            if *self.attempt.lock().unwrap() != attempt {
                return; // cancelled, or a newer sign-in replaced this one
            }
            match device::poll(&start.device_code) {
                Ok(DevicePoll::Approved { key, .. }) => return self.signed_in(key),
                Ok(DevicePoll::Pending) => {}
                Ok(DevicePoll::SlowDown) => wait += Duration::from_secs(2),
                Ok(DevicePoll::Denied) => return failed("denied"),
                Ok(DevicePoll::Expired) => return failed("expired"),
                // Offline for a moment: keep waiting until the code itself expires.
                Err(_) => {}
            }
        }
        failed("expired");
    }

    pub fn cancel_sign_in(&self) {
        *self.attempt.lock().unwrap() += 1;
        *self.sign_in.lock().unwrap() = SignIn::Idle;
    }

    /// Sign out here and revoke the key on the platform.
    pub fn sign_out(&self) {
        if let Some(s) = self.session.lock().unwrap().take() {
            crate::sign_out(&self.app, s.key());
        }
        self.remember_workspace(None);
        *self.expired.lock().unwrap() = false;
    }

    /// Work in workspace `id` from now on, and remember it across launches.
    pub fn select_workspace(&self, id: i64) -> Result<(), String> {
        let s = self.require()?;
        s.set_workspace(Some(id));
        self.remember_workspace(Some(id));
        s.who().map(|_| ()).map_err(|e| self.fail(e))
    }
}
