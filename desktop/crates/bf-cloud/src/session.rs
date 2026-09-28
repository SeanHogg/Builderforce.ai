//! A signed-in session: the `bfk_` key, exchanged for a short-lived workspace token
//! (`/api/auth/tenant-api-key-token`) and re-scoped to the chosen workspace
//! (`/api/vscode/tenants/:id/token`) — the extension's `bfApi` rules. The token is reused
//! until a minute before it expires; a 401 re-exchanges once; a refused key is
//! [`CloudError::KeyRejected`], so the window signs out rather than looping.

use crate::{gateway_base, CloudError, TIMEOUT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const REFRESH_MARGIN: Duration = Duration::from_secs(60);
const LLM_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub role: Option<String>,
}

struct Token {
    value: String,
    tenant_id: i64,
    user_id: Option<String>,
    expires_at: Instant,
}

pub struct Session {
    key: String,
    base: String,
    /// The workspace the person chose; `None` = the one the key was minted for.
    workspace: Mutex<Option<i64>>,
    token: Mutex<Option<Token>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Minted {
    token: String,
    #[serde(default)]
    expires_in: Option<u64>,
    tenant_id: i64,
    #[serde(default)]
    user_id: Option<String>,
}

impl Session {
    pub fn new(key: String, workspace: Option<i64>) -> Self {
        Self { key, base: gateway_base(), workspace: Mutex::new(workspace), token: Mutex::new(None) }
    }

    pub fn key(&self) -> &str {
        &self.key
    }

    /// Work in `id` from now on (the next call re-scopes).
    pub fn set_workspace(&self, id: Option<i64>) {
        *self.workspace.lock().unwrap() = id;
        *self.token.lock().unwrap() = None;
    }

    pub fn workspace(&self) -> Option<i64> {
        *self.workspace.lock().unwrap()
    }

    fn mint(&self, path: &str, bearer: Option<&str>, body: Value) -> Result<Minted, CloudError> {
        let mut req = ureq::post(&format!("{}{path}", self.base)).timeout(TIMEOUT);
        if let Some(b) = bearer {
            req = req.set("authorization", &format!("Bearer {b}"));
        }
        req.send_json(body).map_err(CloudError::from_ureq)?.into_json().map_err(|e| CloudError::Unreachable(e.to_string()))
    }

    /// A fresh token for the chosen workspace.
    fn exchange(&self) -> Result<Token, CloudError> {
        let base = match self.mint("/api/auth/tenant-api-key-token", None, json!({ "apiKey": self.key })) {
            Err(CloudError::Status { code: 400 | 401, .. }) => return Err(CloudError::KeyRejected),
            other => other?,
        };
        let user_id = base.user_id.clone();
        let wanted = self.workspace();
        let minted = match wanted {
            Some(id) if id != base.tenant_id => {
                match self.mint(&format!("/api/vscode/tenants/{id}/token"), Some(&base.token), json!({})) {
                    Ok(m) => m,
                    // No longer a member there: fall back to the key's own workspace.
                    Err(CloudError::Status { code: 403 | 404, .. }) => {
                        *self.workspace.lock().unwrap() = None;
                        base
                    }
                    Err(e) => return Err(e),
                }
            }
            _ => base,
        };
        Ok(Token {
            value: minted.token,
            tenant_id: minted.tenant_id,
            user_id: minted.user_id.or(user_id),
            expires_at: Instant::now() + Duration::from_secs(minted.expires_in.unwrap_or(900)),
        })
    }

    fn bearer(&self) -> Result<(String, i64), CloudError> {
        let mut slot = self.token.lock().unwrap();
        if let Some(t) = slot.as_ref() {
            if t.expires_at > Instant::now() + REFRESH_MARGIN {
                return Ok((t.value.clone(), t.tenant_id));
            }
        }
        let t = self.exchange()?;
        let out = (t.value.clone(), t.tenant_id);
        *slot = Some(t);
        Ok(out)
    }

    /// The workspace the session is working in now, and the person's id.
    pub fn who(&self) -> Result<(i64, Option<String>), CloudError> {
        self.bearer()?;
        let slot = self.token.lock().unwrap();
        let t = slot.as_ref().ok_or(CloudError::SignedOut)?;
        Ok((t.tenant_id, t.user_id.clone()))
    }

    fn send(&self, method: &str, path: &str, body: Option<&Value>, timeout: Duration) -> Result<Value, CloudError> {
        let (token, _) = self.bearer()?;
        let req = ureq::request(method, &format!("{}{path}", self.base))
            .timeout(timeout)
            .set("authorization", &format!("Bearer {token}"))
            .set("accept", "application/json");
        let res = match body {
            Some(b) => req.send_json(b.clone()),
            None => req.call(),
        };
        let resp = res.map_err(CloudError::from_ureq)?;
        let text = resp.into_string().map_err(|e| CloudError::Unreachable(e.to_string()))?;
        Ok(if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::String(text)) })
    }

    /// Call the platform API as the signed-in person. A 401 re-exchanges the token once.
    pub fn api(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, CloudError> {
        self.api_with_timeout(method, path, body, TIMEOUT)
    }

    /// [`Session::api`] for a call the platform takes longer over (training, audits).
    pub fn api_with_timeout(&self, method: &str, path: &str, body: Option<Value>, timeout: Duration) -> Result<Value, CloudError> {
        match self.send(method, path, body.as_ref(), timeout) {
            Err(e) if e.is_unauthorized() => {
                *self.token.lock().unwrap() = None;
                self.send(method, path, body.as_ref(), timeout)
            }
            other => other,
        }
    }

    pub fn workspaces(&self) -> Result<Vec<Workspace>, CloudError> {
        let v = self.api("GET", "/api/vscode/tenants", None)?;
        Ok(serde_json::from_value(v.get("tenants").cloned().unwrap_or(Value::Array(vec![]))).unwrap_or_default())
    }

    /// One non-streamed completion from the LLM gateway (the key is its credential). The
    /// gateway routes the model; `model` pins one.
    pub fn complete(&self, messages: &Value, model: Option<&str>) -> Result<String, CloudError> {
        let mut body = json!({ "messages": messages, "stream": false });
        if let Some(m) = model {
            body["model"] = json!(m);
        }
        let res = ureq::post(&format!("{}/llm/v1/chat/completions", self.base))
            .timeout(LLM_TIMEOUT)
            .set("authorization", &format!("Bearer {}", self.key))
            .send_json(body);
        let v: Value = match res {
            Err(ureq::Error::Status(401, _)) => return Err(CloudError::KeyRejected),
            other => other.map_err(CloudError::from_ureq)?.into_json().map_err(|e| CloudError::Unreachable(e.to_string()))?,
        };
        Ok(v.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or_default().to_string())
    }
}
