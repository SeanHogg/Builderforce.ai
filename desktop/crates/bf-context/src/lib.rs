//! bf-context — the Builderforce local context service.
//!
//! A registry of indexed workspaces (bf-index), one operation surface (`api`), and two
//! transports over it: loopback HTTP for the VS Code extension and the desktop UI, and an
//! MCP stdio server for Claude Code / Cursor. The desktop app embeds this crate; the
//! `bf-context` binary runs it headless.

pub mod api;
pub mod client;
pub mod discovery;
pub mod embedder;
pub mod mcp;
pub mod paths;
pub mod registry;
pub mod server;

pub use registry::Registry;
