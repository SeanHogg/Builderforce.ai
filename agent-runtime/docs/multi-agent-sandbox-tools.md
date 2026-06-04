---
title: "Multi-Agent Sandbox Tools"
summary: "Per-group and per-agent tool allow/deny policies across channels"
---

# Multi-Agent Sandbox Tools

BuilderForce Agents lets you restrict which tools are available on a per-group, per-agent, or per-context basis. This page covers the tool policy system and how to apply allow/deny lists at different scopes.

## Tool Policy Scopes

Tool policies can be set at several levels (most-specific wins):

| Scope      | Config key                                             | Description                            |
| ---------- | ------------------------------------------------------ | -------------------------------------- |
| Global     | `tools.allow` / `tools.deny`                           | Applied to all agent runs              |
| Sandbox    | `tools.sandbox.tools.allow` / `.deny`                  | Applied when running in Docker sandbox |
| Sub-agents | `tools.subagents.tools.allow` / `.deny`                | Applied to spawned sub-agent sessions  |
| Per-agent  | `agents.list[].tools.allow` / `.deny`                  | Applied to a specific named agent      |
| Per-group  | `channels.<channel>.groups.<id>.tools.allow` / `.deny` | Applied to a specific group/channel    |

## Per-Group Tool Policies

You can control which tools are available when the agent responds in a specific group (Discord server, Telegram group, Slack workspace, etc.):

```yaml
channels:
  telegram:
    groups:
      "-1001234567890":
        tools:
          allow:
            - sessions.list
            - web_search
          deny:
            - exec
```

This is useful for:

- Disabling `exec` in public-facing groups while keeping it available in private DMs
- Allowing only specific tools in a shared team channel
- Restricting plugin tools to trusted groups only

## Plugin Channel Support

Per-group tool policies work across all built-in channels (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams) **and** plugin channels. Plugin authors can opt-in to the shared tool policy helpers.

## Allow vs Deny

- **`allow`**: Explicit allowlist — only the listed tools are available. All others are blocked.
- **`deny`**: Explicit denylist — all tools are available _except_ the listed ones.
- **`alsoAllow`**: Additive allowlist — extends the profile default without replacing it. Cannot be combined with `allow` in the same scope.

`allow` and `alsoAllow` are mutually exclusive within the same scope. Use `alsoAllow` to extend a profile's defaults rather than replacing the entire list.

## Sandbox Tool Policy

When Docker sandboxing is enabled, you can further restrict what tools sandbox sessions can use:

```yaml
tools:
  sandbox:
    tools:
      allow:
        - browser.open
        - web_search
      deny:
        - exec
```

## Sub-Agent Tool Policy

Tools available to spawned sub-agents can be restricted independently of the parent session:

```yaml
tools:
  subagents:
    tools:
      deny:
        - sandbox
```

## See Also

- [Sandbox](https://docs.builderforce.ai/sandbox) — Docker-based execution isolation
- [Exec approvals](https://docs.builderforce.ai/tools/exec-approvals) — per-command approval gates
- [Groups](https://docs.builderforce.ai/concepts/groups) — group routing and allowlist configuration
- [Sub-agents](https://docs.builderforce.ai/tools/subagents) — spawning isolated agent sessions
- [Gateway configuration](https://docs.builderforce.ai/gateway/configuration) — full config reference
