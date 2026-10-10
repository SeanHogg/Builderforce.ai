//! The MCP servers a person connects to Synapse — installed in one click from the
//! [`catalog`](crate::catalog) or added by hand — and their tools, for the Brain to use.
//!
//! Settings (`connectors.json`) hold the command, arguments and plain variables; tokens
//! live in the OS credential store and are only read to start the server. Each enabled
//! server runs as its own child, started on first use; its tool list is read once and
//! kept until the server changes.

use crate::catalog::{self, InputKind};
use crate::client::{McpClient, ToolInfo, CALL_TIMEOUT};
use crate::spec::LaunchSpec;
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// A model reads tool names up to this long.
const MAX_TOOL_NAME: usize = 64;
/// Prefix of a hosted tool's name as the model sees it, so it never collides with the
/// platform's `builtin_*` tools.
pub const TOOL_PREFIX: &str = "mcp_";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorConfig {
    pub id: String,
    pub name: String,
    /// The catalog entry it was installed from; `None` for one added by hand.
    #[serde(default)]
    pub catalog_id: Option<String>,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Plain variables.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Variables whose values are in the credential store.
    #[serde(default)]
    pub secret_keys: Vec<String>,
    #[serde(default = "yes")]
    pub enabled: bool,
}

fn yes() -> bool {
    true
}

/// A connector as the window shows it: its settings (never its secrets) and, once read,
/// its tools or why they could not be read.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorView {
    #[serde(flatten)]
    pub config: ConnectorConfig,
    pub tools: Option<Vec<ToolInfo>>,
    pub error: Option<String>,
}

/// A hosted tool as the Brain offers it.
#[derive(Debug, Clone)]
pub struct HostedTool {
    pub connector_id: String,
    pub connector_name: String,
    /// The name the model calls it by (`mcp_github_search_issues`).
    pub flat_name: String,
    pub tool: ToolInfo,
}

#[derive(Default)]
struct Live {
    clients: HashMap<String, Arc<McpClient>>,
    tools: HashMap<String, Result<Vec<ToolInfo>, String>>,
}

pub struct Host {
    file: PathBuf,
    configs: Mutex<Vec<ConnectorConfig>>,
    live: Mutex<Live>,
}

fn secret_entry(connector: &str, key: &str) -> String {
    format!("connector:{connector}:{key}")
}

/// Lower-case letters, digits and `_` — what a tool name may hold.
fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('_') {
            out.push('_');
        }
    }
    out.trim_matches('_').to_string()
}

pub fn flat_name(connector_name: &str, tool: &str) -> String {
    let mut name = format!("{TOOL_PREFIX}{}_{}", slug(connector_name), slug(tool));
    name.truncate(MAX_TOOL_NAME);
    name
}

/// A command line split into words; double quotes keep spaces in one word.
pub fn split_command_line(line: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut any = false;
    for c in line.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                any = true;
            }
            c if c.is_whitespace() && !quoted => {
                if any {
                    words.push(std::mem::take(&mut cur));
                    any = false;
                }
            }
            c => {
                cur.push(c);
                any = true;
            }
        }
    }
    if any {
        words.push(cur);
    }
    words
}

fn new_id(name: &str) -> String {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{}-{:x}", slug(name), nanos & 0xff_ffff)
}

impl Host {
    pub fn open(dir: &Path) -> Arc<Self> {
        let file = dir.join("connectors.json");
        let configs = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
        Arc::new(Self { file, configs: Mutex::new(configs), live: Mutex::new(Live::default()) })
    }

    fn save(&self, configs: &[ConnectorConfig]) -> Result<()> {
        if let Some(dir) = self.file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&self.file, serde_json::to_string_pretty(configs)?)?;
        Ok(())
    }

    fn change(&self, f: impl FnOnce(&mut Vec<ConnectorConfig>) -> Result<()>) -> Result<()> {
        let mut configs = self.configs.lock().unwrap();
        let mut next = configs.clone();
        f(&mut next)?;
        self.save(&next)?;
        *configs = next;
        Ok(())
    }

    /// Forget a connector's running child and tool list (its settings changed).
    fn drop_live(&self, id: &str) {
        let mut live = self.live.lock().unwrap();
        if let Some(c) = live.clients.remove(id) {
            c.disconnect();
        }
        live.tools.remove(id);
    }

    pub fn list(&self) -> Vec<ConnectorView> {
        let live = self.live.lock().unwrap();
        self.configs
            .lock()
            .unwrap()
            .iter()
            .map(|c| {
                let (tools, error) = match live.tools.get(&c.id) {
                    Some(Ok(t)) => (Some(t.clone()), None),
                    Some(Err(e)) => (None, Some(e.clone())),
                    None => (None, None),
                };
                ConnectorView { config: c.clone(), tools, error }
            })
            .collect()
    }

    /// Install a catalog connector. `values` holds each input by its key (`folder` for a
    /// folder input). Secrets go to the credential store before anything is saved.
    pub fn install(&self, catalog_id: &str, values: &BTreeMap<String, String>) -> Result<ConnectorConfig> {
        let entry = catalog::find(catalog_id).ok_or_else(|| anyhow!("no connector '{catalog_id}' in the catalog"))?;
        let id = new_id(entry.name);
        let mut args: Vec<String> = entry.npx.iter().map(|s| s.to_string()).collect();
        let (mut env, mut secret_keys) = (BTreeMap::new(), Vec::new());
        for input in entry.inputs {
            let key = if input.kind == InputKind::Folder { "folder" } else { input.key };
            let value = values.get(key).map(|v| v.trim()).filter(|v| !v.is_empty());
            let Some(value) = value else {
                if input.required {
                    bail!("{} needs {key}", entry.name);
                }
                continue;
            };
            match input.kind {
                InputKind::Folder => args.push(value.to_string()),
                InputKind::Text => {
                    env.insert(input.key.to_string(), value.to_string());
                }
                InputKind::Secret => {
                    bf_vault::save(&secret_entry(&id, input.key), value).context("could not keep the token in the credential store")?;
                    secret_keys.push(input.key.to_string());
                }
            }
        }
        let spec = LaunchSpec::npx(args, cfg!(windows));
        let config = ConnectorConfig {
            id,
            name: entry.name.to_string(),
            catalog_id: Some(entry.id.to_string()),
            command: spec.command,
            args: spec.args,
            env,
            secret_keys,
            enabled: true,
        };
        let saved = config.clone();
        self.change(|all| {
            all.push(saved);
            Ok(())
        })?;
        Ok(config)
    }

    /// Add a server by hand: its command line, and variables (all kept as secrets, since
    /// Synapse cannot tell a token from a setting).
    pub fn add_custom(&self, name: &str, command_line: &str, env: &BTreeMap<String, String>) -> Result<ConnectorConfig> {
        let name = name.trim();
        if name.is_empty() {
            bail!("a connector needs a name");
        }
        let mut words = split_command_line(command_line);
        if words.is_empty() {
            bail!("a connector needs a command");
        }
        let command = words.remove(0);
        let id = new_id(name);
        let mut secret_keys = Vec::new();
        for (k, v) in env.iter().filter(|(k, _)| !k.trim().is_empty()) {
            bf_vault::save(&secret_entry(&id, k.trim()), v).context("could not keep the variable in the credential store")?;
            secret_keys.push(k.trim().to_string());
        }
        let config = ConnectorConfig { id, name: name.to_string(), catalog_id: None, command, args: words, env: BTreeMap::new(), secret_keys, enabled: true };
        let saved = config.clone();
        self.change(|all| {
            all.push(saved);
            Ok(())
        })?;
        Ok(config)
    }

    pub fn remove(&self, id: &str) -> Result<()> {
        let mut removed = None;
        self.change(|all| {
            let at = all.iter().position(|c| c.id == id).ok_or_else(|| anyhow!("no connector '{id}'"))?;
            removed = Some(all.remove(at));
            Ok(())
        })?;
        self.drop_live(id);
        if let Some(c) = removed {
            for k in &c.secret_keys {
                bf_vault::delete(&secret_entry(&c.id, k));
            }
        }
        Ok(())
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        self.change(|all| {
            let c = all.iter_mut().find(|c| c.id == id).ok_or_else(|| anyhow!("no connector '{id}'"))?;
            c.enabled = enabled;
            Ok(())
        })?;
        self.drop_live(id);
        Ok(())
    }

    fn config(&self, id: &str) -> Result<ConnectorConfig> {
        self.configs.lock().unwrap().iter().find(|c| c.id == id).cloned().ok_or_else(|| anyhow!("no connector '{id}'"))
    }

    fn client(&self, c: &ConnectorConfig) -> Result<Arc<McpClient>> {
        if let Some(existing) = self.live.lock().unwrap().clients.get(&c.id) {
            return Ok(existing.clone());
        }
        let mut env: Vec<(String, String)> = c.env.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        for k in &c.secret_keys {
            let v = bf_vault::load(&secret_entry(&c.id, k)).ok_or_else(|| anyhow!("{}: the saved value of {k} could not be read", c.name))?;
            env.push((k.clone(), v));
        }
        let client = Arc::new(McpClient::new(LaunchSpec { command: c.command.clone(), args: c.args.clone() }, env, c.name.clone()));
        Ok(self.live.lock().unwrap().clients.entry(c.id.clone()).or_insert(client).clone())
    }

    /// Start the connector (if needed) and read its tools afresh.
    pub fn refresh_tools(&self, id: &str) -> Result<Vec<ToolInfo>> {
        let c = self.config(id)?;
        let result = self.client(&c).and_then(|cl| cl.list_tools());
        let stored = result.as_ref().map(Clone::clone).map_err(|e| format!("{e:#}"));
        self.live.lock().unwrap().tools.insert(id.to_string(), stored);
        result
    }

    /// Every tool of every enabled connector. A connector whose tools were never read is
    /// read now; one that fails is left out (and says why in [`Host::list`]).
    pub fn hosted_tools(&self) -> Vec<HostedTool> {
        let enabled: Vec<ConnectorConfig> = self.configs.lock().unwrap().iter().filter(|c| c.enabled).cloned().collect();
        let mut out = Vec::new();
        for c in enabled {
            let known = self.live.lock().unwrap().tools.get(&c.id).cloned();
            let tools = match known {
                Some(t) => t.ok(),
                None => self.refresh_tools(&c.id).ok(),
            };
            for tool in tools.unwrap_or_default() {
                out.push(HostedTool { connector_id: c.id.clone(), connector_name: c.name.clone(), flat_name: flat_name(&c.name, &tool.name), tool });
            }
        }
        out
    }

    /// Run one tool; the result is its text, as the model reads it back.
    pub fn call(&self, connector_id: &str, tool: &str, args: Value) -> Result<String> {
        let c = self.config(connector_id)?;
        if !c.enabled {
            bail!("{} is switched off", c.name);
        }
        let v = self.client(&c)?.call_with_timeout(tool, args, CALL_TIMEOUT * 4)?;
        Ok(match v {
            Value::String(s) => s,
            other => other.to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_names_are_prefixed_slugged_and_bounded() {
        assert_eq!(flat_name("GitHub", "search_issues"), "mcp_github_search_issues");
        assert_eq!(flat_name("Brave Search", "brave.web-search"), "mcp_brave_search_brave_web_search");
        assert!(flat_name(&"x".repeat(80), "t").len() <= MAX_TOOL_NAME);
    }

    #[test]
    fn a_command_line_splits_on_spaces_outside_quotes() {
        assert_eq!(split_command_line(r#"npx -y "@scope/pkg" "C:\My Files""#), ["npx", "-y", "@scope/pkg", r"C:\My Files"]);
        assert_eq!(split_command_line("  uvx   mcp-server-fetch "), ["uvx", "mcp-server-fetch"]);
        assert!(split_command_line("   ").is_empty());
    }

    #[test]
    fn a_connector_without_secrets_is_kept_listed_switched_and_removed() {
        let dir = tempfile::tempdir().unwrap();
        let host = Host::open(dir.path());
        let c = host.install("playwright", &BTreeMap::new()).unwrap();
        assert_eq!(c.catalog_id.as_deref(), Some("playwright"));
        assert!(c.args.iter().any(|a| a == "@playwright/mcp@latest"));
        let reopened = Host::open(dir.path());
        assert_eq!(reopened.list().len(), 1);
        reopened.set_enabled(&c.id, false).unwrap();
        assert!(!Host::open(dir.path()).list()[0].config.enabled);
        assert!(reopened.hosted_tools().is_empty());
        reopened.remove(&c.id).unwrap();
        assert!(Host::open(dir.path()).list().is_empty());
    }

    #[test]
    fn a_missing_required_input_is_refused_before_anything_is_saved() {
        let dir = tempfile::tempdir().unwrap();
        let host = Host::open(dir.path());
        assert!(host.install("filesystem", &BTreeMap::new()).is_err());
        assert!(host.install("nope", &BTreeMap::new()).is_err());
        assert!(host.list().is_empty());
        let mut v = BTreeMap::new();
        v.insert("folder".to_string(), "C:/work".to_string());
        let c = host.install("filesystem", &v).unwrap();
        assert_eq!(c.args.last().map(String::as_str), Some("C:/work"));
    }
}
