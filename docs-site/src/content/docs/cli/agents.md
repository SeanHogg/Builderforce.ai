---
summary: "CLI reference for `coderclaw agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
title: "agents"
---

# `coderclaw agents`

Manage isolated agents (workspaces + auth + routing).

Related:

- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
coderclaw agents list
coderclaw agents add work --workspace ~/.coderclaw/workspace-work
coderclaw agents set-identity --workspace ~/.coderclaw/workspace --from-identity
coderclaw agents set-identity --agent main --avatar avatars/coderclaw.png
coderclaw agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:

- Example path: `~/.coderclaw/workspace/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:

- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
coderclaw agents set-identity --workspace ~/.coderclaw/workspace --from-identity
```

Override fields explicitly:

```bash
coderclaw agents set-identity --agent main --name "CoderClaw" --emoji "🦞" --avatar avatars/coderclaw.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "CoderClaw",
          theme: "space lobster",
          emoji: "🦞",
          avatar: "avatars/coderclaw.png",
        },
      },
    ],
  },
}
```
