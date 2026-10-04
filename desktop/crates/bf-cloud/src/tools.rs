//! The platform's tools — the ONE server-side catalog the web Brain and the VS Code
//! extension also drive (`GET /llm/v1/mcp/tools`, `POST /llm/v1/mcp/call`): projects,
//! tickets, boards, specs, OKRs, the workspace's connectors and MCP servers. Nothing is
//! re-declared here; a capability added on the platform reaches the desktop by itself.
//! Each call runs on the platform as the signed-in person, with their rights.

use crate::{CloudError, Session};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

/// A tool call can be a search or an import; give it the time it takes.
const CALL_TIMEOUT: Duration = Duration::from_secs(120);

/// One advertised tool (the platform's `McpToolEntry`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformTool {
    /// Which server owns it; sent back on the call.
    pub extension_id: String,
    /// Its name on that server; sent back on the call.
    pub tool: String,
    /// The flat name the model sees (`builtin_tasks_create`).
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub parameters: Option<Value>,
    /// Whether it changes anything. Absent (a tenant's own MCP server) counts as yes.
    #[serde(default)]
    pub mutates: Option<bool>,
}

impl PlatformTool {
    /// Whether running it needs the person's go-ahead.
    pub fn writes(&self) -> bool {
        self.mutates != Some(false)
    }

    /// The tool as a completion request offers it to the model.
    pub fn as_function(&self) -> Value {
        json!({
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters.clone().unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
            }
        })
    }
}

impl Session {
    /// The tools of one catalog `surface` (`full`, `delivery`, `readonly`, …; see the
    /// platform's `toolSurfaces.ts`).
    pub fn platform_tools(&self, surface: &str) -> Result<Vec<PlatformTool>, CloudError> {
        let v: Value = self
            .gateway("GET", &format!("/mcp/tools?surface={surface}"), None, crate::TIMEOUT)?
            .into_json()
            .map_err(|e| CloudError::Unreachable(e.to_string()))?;
        Ok(serde_json::from_value(v.get("tools").cloned().unwrap_or(json!([]))).unwrap_or_default())
    }

    /// Run one tool on the platform. The result is what the model reads back, as text. A
    /// tool that fails answers [`CloudError::Status`] with the platform's reason, which the
    /// model is told rather than the turn ending.
    pub fn call_platform_tool(&self, tool: &PlatformTool, arguments: Value) -> Result<String, CloudError> {
        let body = json!({ "extensionId": tool.extension_id, "tool": tool.tool, "arguments": arguments });
        let v: Value = self
            .gateway("POST", "/mcp/call", Some(&body), CALL_TIMEOUT)?
            .into_json()
            .map_err(|e| CloudError::Unreachable(e.to_string()))?;
        Ok(match v.get("result").unwrap_or(&v) {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tool_that_does_not_say_it_only_reads_counts_as_writing() {
        let parse = |v: Value| serde_json::from_value::<PlatformTool>(v).unwrap();
        let read = parse(json!({ "extensionId": "builtin", "tool": "tasks.list", "name": "builtin_tasks_list", "description": "List", "parameters": { "type": "object" }, "mutates": false }));
        let external = parse(json!({ "extensionId": "x1", "tool": "send", "name": "x1_send" }));
        assert!(!read.writes());
        assert!(external.writes());
        assert_eq!(external.as_function()["function"]["parameters"]["type"], "object");
        assert_eq!(read.as_function()["function"]["name"], "builtin_tasks_list");
    }
}
