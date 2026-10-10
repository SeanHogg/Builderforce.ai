//! The one-click connectors: published MCP servers Synapse knows how to install, as DATA.
//! A new connector is an entry here, never a branch in the host. Each names its `npx`
//! package and the inputs it needs from the person — a folder (an argument), a secret
//! (an environment variable kept in the OS credential store) or plain text.
//!
//! What each connector does is said in the window's language (`connectors.catalog.<id>`),
//! so only the brand name lives here.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum InputKind {
    /// A folder on this machine, appended to the arguments.
    Folder,
    /// A token or key: an environment variable, kept in the credential store.
    Secret,
    /// Plain text: an environment variable, kept in the connector's settings.
    Text,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    /// The environment variable it sets (`Folder` inputs are arguments and name none).
    pub key: &'static str,
    pub kind: InputKind,
    pub required: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: &'static str,
    pub name: &'static str,
    /// What follows `npx -y`: the package (and binary) and fixed arguments.
    pub npx: &'static [&'static str],
    pub inputs: &'static [Input],
    /// Where the person gets a token, when one is needed.
    pub docs: &'static str,
}

const fn secret(key: &'static str) -> Input {
    Input { key, kind: InputKind::Secret, required: true }
}

const FOLDER: Input = Input { key: "", kind: InputKind::Folder, required: true };

pub const CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        id: "filesystem",
        name: "Filesystem",
        npx: &["@modelcontextprotocol/server-filesystem"],
        inputs: &[FOLDER],
        docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    },
    CatalogEntry {
        id: "github",
        name: "GitHub",
        npx: &["@modelcontextprotocol/server-github"],
        inputs: &[secret("GITHUB_PERSONAL_ACCESS_TOKEN")],
        docs: "https://github.com/settings/personal-access-tokens",
    },
    CatalogEntry {
        id: "slack",
        name: "Slack",
        npx: &["@modelcontextprotocol/server-slack"],
        inputs: &[secret("SLACK_BOT_TOKEN"), Input { key: "SLACK_TEAM_ID", kind: InputKind::Text, required: true }],
        docs: "https://api.slack.com/apps",
    },
    CatalogEntry {
        id: "brave-search",
        name: "Brave Search",
        npx: &["@modelcontextprotocol/server-brave-search"],
        inputs: &[secret("BRAVE_API_KEY")],
        docs: "https://brave.com/search/api/",
    },
    CatalogEntry {
        id: "playwright",
        name: "Playwright",
        npx: &["@playwright/mcp@latest"],
        inputs: &[],
        docs: "https://github.com/microsoft/playwright-mcp",
    },
    CatalogEntry {
        id: "context7",
        name: "Context7",
        npx: &["@upstash/context7-mcp"],
        inputs: &[],
        docs: "https://github.com/upstash/context7",
    },
    CatalogEntry {
        id: "sequential-thinking",
        name: "Sequential Thinking",
        npx: &["@modelcontextprotocol/server-sequential-thinking"],
        inputs: &[],
        docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    },
];

pub fn find(id: &str) -> Option<&'static CatalogEntry> {
    CATALOG.iter().find(|e| e.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_folders_set_no_variable() {
        let mut ids: Vec<_> = CATALOG.iter().map(|e| e.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), CATALOG.len());
        for e in CATALOG {
            assert!(!e.npx.is_empty(), "{} names no package", e.id);
            for i in e.inputs {
                assert_eq!(i.kind == InputKind::Folder, i.key.is_empty(), "{}: {:?}", e.id, i);
            }
        }
        assert_eq!(find("github").map(|e| e.name), Some("GitHub"));
    }
}
