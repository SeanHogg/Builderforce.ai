//! How a stdio MCP server is started: a command and its arguments. Most published servers
//! are npm packages run through `npx`, which on Windows is a `.cmd` shim that has to go
//! through `cmd` — written once here for every server Synapse starts.

use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchSpec {
    pub command: String,
    pub args: Vec<String>,
}

impl LaunchSpec {
    /// A script run with `node`.
    pub fn node(script: &Path) -> Self {
        Self { command: "node".into(), args: vec![script.to_string_lossy().into_owned()] }
    }

    /// `npx -y <args…>` — `args` names the package(s) and the binary, as `npx` takes them.
    pub fn npx(args: Vec<String>, windows: bool) -> Self {
        let mut full = vec!["-y".to_string()];
        full.extend(args);
        Self::shim("npx", full, windows)
    }

    /// A command that may be a `.cmd` shim on Windows (`npx`, `uvx`, …).
    pub fn shim(command: &str, args: Vec<String>, windows: bool) -> Self {
        if windows {
            let mut with_shell = vec!["/c".to_string(), command.to_string()];
            with_shell.extend(args);
            Self { command: "cmd".into(), args: with_shell }
        } else {
            Self { command: command.into(), args }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn npx_goes_through_cmd_on_windows_only() {
        let w = LaunchSpec::npx(vec!["pkg".into()], true);
        assert_eq!(w.command, "cmd");
        assert_eq!(w.args, ["/c", "npx", "-y", "pkg"]);
        let u = LaunchSpec::npx(vec!["pkg".into()], false);
        assert_eq!(u.command, "npx");
        assert_eq!(u.args, ["-y", "pkg"]);
    }
}
