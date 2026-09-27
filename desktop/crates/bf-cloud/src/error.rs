use std::fmt;

/// Why a call to builderforce.ai did not succeed — split the way the window must react:
/// a refused key signs out, an unreachable platform keeps the session and says so.
#[derive(Debug)]
pub enum CloudError {
    /// Nobody is signed in.
    SignedOut,
    /// The platform refused the saved key (revoked or deleted): sign in again.
    KeyRejected,
    /// The platform could not be reached (offline, DNS, timeout).
    Unreachable(String),
    /// The platform answered with an error.
    Status { code: u16, message: String },
}

impl fmt::Display for CloudError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CloudError::SignedOut => write!(f, "not signed in to Builderforce"),
            CloudError::KeyRejected => write!(f, "Builderforce no longer accepts this sign-in; sign in again"),
            CloudError::Unreachable(e) => write!(f, "Builderforce could not be reached: {e}"),
            CloudError::Status { code, message } => write!(f, "Builderforce answered {code}: {message}"),
        }
    }
}

impl std::error::Error for CloudError {}

impl CloudError {
    /// A ureq failure, classified. The body's `error` field is the platform's message.
    pub(crate) fn from_ureq(err: ureq::Error) -> Self {
        match err {
            ureq::Error::Status(code, resp) => {
                let text = resp.into_string().unwrap_or_default();
                let message = serde_json::from_str::<serde_json::Value>(&text)
                    .ok()
                    .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
                    .unwrap_or_else(|| text.chars().take(200).collect());
                CloudError::Status { code, message }
            }
            ureq::Error::Transport(t) => CloudError::Unreachable(t.to_string()),
        }
    }

    pub fn is_unauthorized(&self) -> bool {
        matches!(self, CloudError::Status { code: 401, .. })
    }
}
