# Distribution

Everything needed to list Builderforce in a marketplace. The research behind the
channel choices is in [docs/marketing/DISTRIBUTION-CHANNELS.md](../docs/marketing/DISTRIBUTION-CHANNELS.md);
this directory is the operational half — what actually ships, and what is still
waiting on a credential.

## Canonical copy

[`listing.json`](./listing.json) holds the strings every channel asks for — title,
tagline, short and long description, icon, tags, endpoint. **Edit it there.**
`node distribution/build.mjs` stamps it into the generated payloads and fails if
[`../server.json`](../server.json) has drifted from it.

```bash
node distribution/build.mjs          # regenerate
node distribution/build.mjs --check  # CI: fail on drift
```

## Automated on release

These run from [`.github/workflows/release.yml`](../.github/workflows/release.yml)
and need no manual step once their secret exists.

| Channel | What ships | Secret | Behaviour without it |
| --- | --- | --- | --- |
| Visual Studio Marketplace | `clients/vscode` VSIX | `VSCE_PAT` | Warns and skips |
| Open VSX (Cursor, Windsurf, VSCodium, Gitpod) | the same VSIX | `OVSX_PAT` | Warns and skips |
| MCP Registry | [`../server.json`](../server.json) — the remote `/mcp` server | none (GitHub OIDC) | Runs; refuses to publish if the endpoint isn't answering |
| GitHub Marketplace | [`../actions/dispatch-agent`](../actions/dispatch-agent) | `ACTION_MIRROR_TOKEN`, `ACTION_MIRROR_REPO` | Warns and skips; the in-repo action still works |
| npm | the SDK packages | `NPM_TOKEN` | Publish fails |

The MCP Registry job probes `https://api.builderforce.ai/mcp` and refuses to
publish unless it answers `401` — a listing that points at a dead endpoint is
worse than no listing, because every client that discovers it fails on connect.

The memory MCP server publishes from its own repo:
[`builderforce-memory/packages/memory-mcp/server.json`](https://github.com/SeanHogg/builderforce-memory),
on tag, also over OIDC.

## Prepared, submitted by hand

| Channel | Payload | How |
| --- | --- | --- |
| Docker MCP Catalog | [`docker-mcp-registry/builderforce/`](./docker-mcp-registry/builderforce) | Copy the directory into a fork of `github.com/docker/mcp-registry` under `servers/`, run `task validate -- --name builderforce`, open a PR. |
| Anthropic Connectors Directory | — | Submit `https://api.builderforce.ai/mcp` via the MCP directory form. Needs the reviewer test tenant (below). |
| Cline MCP Marketplace | — | Open an issue on `cline/mcp-marketplace` with the repo URL and a 400×400 PNG logo. |
| Smithery / Glama / mcp.so / PulseMCP / LobeHub | — | Self-register; all read the same `server.json`. |

Regenerate the Docker payload rather than editing it — `build.mjs` owns those files.

## Already listed elsewhere

- **Claude Code plugin marketplace** — `builderforce-memory` ships a generated
  plugin and a `.claude-plugin/marketplace.json`. Users add it with
  `/plugin marketplace add SeanHogg/builderforce-memory`.
- **npm** — the `@seanhogg/builderforce-*` packages.

## Still blocked

| Item | Blocker |
| --- | --- |
| Hugging Face (`hf-export/Evermind`) | Needs an HF account + write token. The model card and all four artifact formats are ready to push. |
| Reviewer test tenant | Needs a live environment: a seeded tenant with realistic projects, tickets and agents, plus a shared credential. Hard requirement for Anthropic, Slack, Atlassian, AWS and Microsoft review. |
| AWS / Microsoft / Google cloud marketplaces | Legal entity + partner-program enrolment before any listing can be created. |

## Adding a channel

1. If it needs new copy, add the field to `listing.json` — never inline a second
   copy of a description.
2. Generate its payload in `build.mjs` (or verify an existing manifest against
   the canonical copy, as it does for `server.json`).
3. Automate the submission in `release.yml` when the channel has an API; otherwise
   document the manual step in the table above.
