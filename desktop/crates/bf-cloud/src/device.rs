//! Sign in through the browser: the platform's device flow (RFC 8628), the one the VS Code
//! extension uses. `start` asks for a code pair; the person approves the code on
//! `/activate` (which names this app); `poll` hands the minted key over exactly once.

use crate::{gateway_base, CloudError, CLIENT, TIMEOUT};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    #[serde(default = "default_interval")]
    pub interval: u64,
    #[serde(default = "default_expires")]
    pub expires_in: u64,
}

fn default_interval() -> u64 {
    5
}
fn default_expires() -> u64 {
    600
}

#[derive(Debug)]
pub enum DevicePoll {
    Approved { key: String, tenant_id: i64 },
    Pending,
    /// Polled too soon: wait longer before the next poll.
    SlowDown,
    Denied,
    Expired,
}

pub fn start() -> Result<DeviceStart, CloudError> {
    ureq::post(&format!("{}/api/auth/device/code", gateway_base()))
        .timeout(TIMEOUT)
        .send_json(json!({ "client": CLIENT }))
        .map_err(CloudError::from_ureq)?
        .into_json()
        .map_err(|e| CloudError::Unreachable(e.to_string()))
}

pub fn poll(device_code: &str) -> Result<DevicePoll, CloudError> {
    #[derive(Deserialize)]
    struct Approved {
        access_key: String,
        tenant_id: i64,
    }
    let res = ureq::post(&format!("{}/api/auth/device/token", gateway_base()))
        .timeout(TIMEOUT)
        .send_json(json!({ "device_code": device_code }));
    match res {
        Ok(r) => {
            let a: Approved = r.into_json().map_err(|e| CloudError::Unreachable(e.to_string()))?;
            Ok(DevicePoll::Approved { key: a.access_key, tenant_id: a.tenant_id })
        }
        Err(ureq::Error::Status(428, _)) => Ok(DevicePoll::Pending),
        Err(ureq::Error::Status(429, _)) => Ok(DevicePoll::SlowDown),
        Err(ureq::Error::Status(403, _)) => Ok(DevicePoll::Denied),
        Err(ureq::Error::Status(410, _)) => Ok(DevicePoll::Expired),
        Err(e) => Err(CloudError::from_ureq(e)),
    }
}
