//! The tools a Brain turn may use, from both places they come from: the platform's
//! catalog (projects, tickets, boards — run on builderforce.ai as the person) and the MCP
//! servers the person connected to Synapse (run here, by the connector host). The turn
//! sees one list; each tool knows where it runs and whether it needs the person's Approve.

use bf_cloud::tools::PlatformTool;
use bf_cloud::{CloudError, Session};
use bf_mcp::{Host, HostedTool};
use serde_json::{json, Value};

/// The platform catalog the Brain is offered: projects, tickets, boards, specs and OKRs,
/// the workspace's connectors and MCP servers — not the platform's own administration.
const SURFACE: &str = "delivery";

pub enum Tool {
    Platform(PlatformTool),
    Hosted(HostedTool),
}

impl Tool {
    pub fn name(&self) -> &str {
        match self {
            Tool::Platform(t) => &t.name,
            Tool::Hosted(t) => &t.flat_name,
        }
    }

    /// Whether running it needs the person's go-ahead.
    pub fn writes(&self) -> bool {
        match self {
            Tool::Platform(t) => t.writes(),
            Tool::Hosted(t) => !t.tool.read_only,
        }
    }

    /// Its name as a person reads it: `builtin_tasks_create` → `tasks create`,
    /// a connector's tool → `GitHub: search issues`.
    pub fn label(&self) -> String {
        match self {
            Tool::Platform(t) => label(&t.name),
            Tool::Hosted(t) => format!("{}: {}", t.connector_name, t.tool.name.replace(['_', '-'], " ")),
        }
    }

    fn as_function(&self) -> Value {
        match self {
            Tool::Platform(t) => t.as_function(),
            Tool::Hosted(t) => json!({
                "type": "function",
                "function": { "name": t.flat_name, "description": t.tool.description, "parameters": t.tool.input_schema },
            }),
        }
    }

    /// Run it. A refused sign-in is [`CloudError::KeyRejected`] (the turn ends); any other
    /// failure is [`CloudError::Status`], which the model is told.
    pub fn run(&self, s: &Session, host: &Host, args: Value) -> Result<String, CloudError> {
        match self {
            Tool::Platform(t) => s.call_platform_tool(t, args),
            Tool::Hosted(t) => host
                .call(&t.connector_id, &t.tool.name, args)
                .map_err(|e| CloudError::Status { code: 502, message: format!("{e:#}"), reason: None }),
        }
    }
}

/// `builtin_tasks_create` → `tasks create`.
pub fn label(name: &str) -> String {
    name.strip_prefix("builtin_").unwrap_or(name).replace('_', " ")
}

pub struct Toolbox {
    tools: Vec<Tool>,
}

impl Toolbox {
    /// The platform's tools and the connected servers' tools. An unreachable catalog or a
    /// connector that will not start is an answer without those tools, never no answer;
    /// only a refused sign-in ends the turn.
    pub fn gather(s: &Session, host: &Host) -> Result<Self, CloudError> {
        let mut tools: Vec<Tool> = match s.platform_tools(SURFACE) {
            Ok(t) => t.into_iter().map(Tool::Platform).collect(),
            Err(CloudError::KeyRejected) => return Err(CloudError::KeyRejected),
            Err(_) => Vec::new(),
        };
        tools.extend(host.hosted_tools().into_iter().map(Tool::Hosted));
        Ok(Self { tools })
    }

    pub fn find(&self, name: &str) -> Option<&Tool> {
        self.tools.iter().find(|t| t.name() == name)
    }

    /// The tools as a completion request offers them.
    pub fn offered(&self) -> Vec<Value> {
        self.tools.iter().map(Tool::as_function).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bf_mcp::ToolInfo;

    #[test]
    fn a_tool_reads_as_what_it_does() {
        assert_eq!(label("builtin_tasks_create"), "tasks create");
        assert_eq!(label("acme_send_invoice"), "acme send invoice");
    }

    #[test]
    fn a_hosted_tool_needs_approval_unless_it_says_it_only_reads() {
        let hosted = |read_only| {
            Tool::Hosted(HostedTool {
                connector_id: "github-1".into(),
                connector_name: "GitHub".into(),
                flat_name: "mcp_github_search_issues".into(),
                tool: ToolInfo { name: "search_issues".into(), description: "Search".into(), input_schema: json!({ "type": "object" }), read_only },
            })
        };
        assert!(hosted(false).writes());
        assert!(!hosted(true).writes());
        assert_eq!(hosted(true).label(), "GitHub: search issues");
        assert_eq!(hosted(true).as_function()["function"]["name"], "mcp_github_search_issues");
    }
}
