//! bf-mcp — Synapse speaking MCP as a *client* and a *host*.
//!
//! - [`client`]: one MCP server over stdio, as a child process (what `bf-memory` uses to
//!   reach the Evermind store, and what every connector runs on);
//! - [`host`]: the servers a person connects — installed in one click from the
//!   [`catalog`] or added by hand — whose tools the Brain can use;
//! - [`spec`]: how a server is started (`npx` and friends, Windows' `.cmd` shims).

pub mod catalog;
pub mod client;
pub mod host;
pub mod spec;

pub use client::{McpClient, ToolInfo, CALL_TIMEOUT};
pub use host::{ConnectorConfig, ConnectorView, Host, HostedTool};
pub use spec::LaunchSpec;
