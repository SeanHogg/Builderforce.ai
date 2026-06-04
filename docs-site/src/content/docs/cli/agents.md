---
summary: "CLI reference for `builderforce agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
title: "agents"
---

# `builderforce agents`

Manage isolated agents (workspaces + auth + routing).

Related:

- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
builderforce agents list
builderforce agents add work --workspace ~/.builderforce/workspace-work
builderforce agents set-identity --workspace ~/.builderforce/workspace --from-identity
builderforce agents set-identity --agent main --avatar avatars/builderforce.png
builderforce agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:

- Example path: `~/.builderforce/workspace/IDENTITY.md`
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
builderforce agents set-identity --workspace ~/.builderforce/workspace --from-identity
```

Override fields explicitly:

```bash
builderforce agents set-identity --agent main --name "BuilderForce Agents" --emoji "🦞" --avatar avatars/builderforce.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "BuilderForce Agents",
          theme: "space lobster",
          emoji: "🦞",
          avatar: "avatars/builderforce.png",
        },
      },
    ],
  },
}
```
