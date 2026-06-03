---
title: "Group Messages"
summary: "How BuilderForce Agents handles messages in group chats, servers, and channels"
---

# Group Messages

BuilderForce Agents can participate in group conversations (WhatsApp groups, Telegram groups, Discord servers, Slack workspaces, etc.). This page covers how group messages are routed, gated, and controlled.

## Group Policy

Each channel's group behavior is controlled by `groupPolicy`:

| Value       | Behavior                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| `open`      | Agent responds to all group messages (no mention required)                                                    |
| `allowlist` | Only messages from senders in `groupAllowFrom`/`allowFrom` are processed (default when channel is configured) |
| `disabled`  | All group messages are blocked; only DMs are handled                                                          |

Example:

```yaml
channels:
  telegram:
    groupPolicy: allowlist
    groupAllowFrom:
      - "123456789"
      - "987654321"
```

## Mention Gating

When `requireMention: true` (the default in most channels), the agent only responds in groups when explicitly mentioned:

```yaml
channels:
  telegram:
    groups:
      "-1001234567890":
        requireMention: true
        mentionPatterns:
          - "@MyBot"
          - "hey bot"
```

Setting `requireMention: false` causes the agent to respond to every message in that group — use carefully in busy groups.

## Per-Group Overrides

You can override settings for individual groups using the group's native ID as the key:

```yaml
channels:
  telegram:
    groups:
      "-1001234567890": # group ID
        requireMention: false # respond to all messages
        allowFrom:
          - "123456789" # only from this sender
  discord:
    groups:
      "1234567890123456789": # Discord server/channel ID
        groupPolicy: open
```

Supported per-group fields (varies by channel):

- `requireMention` — whether the agent must be mentioned
- `mentionPatterns` — custom patterns that trigger a response
- `allowFrom` — sender allowlist (overrides channel-level)
- `groupPolicy` — open / allowlist / disabled
- `tools.allow` / `tools.deny` — restrict tools for this group

## Sender Prefix

In group chats, the sender's display name or ID is prepended to the message so the agent knows who said what:

```
[Alice]: What's the weather today?
```

This context is included in the session history.

## Session Isolation

Each group conversation gets its own isolated session by default — the group session is separate from the DM (main) session with the same user. You can configure session sharing or linking via [session identity links](https://docs.builderforce.ai/concepts/session).

## Group History

You can control how much group message history is kept as context:

```yaml
channels:
  whatsapp:
    groupHistoryLimit: 20 # keep last 20 group messages as context (0 = disabled)
```

## See Also

- [Groups](https://docs.builderforce.ai/concepts/groups) — group allowlists and routing rules
- [Channel routing](https://docs.builderforce.ai/concepts/channel-routing) — how messages are routed to agents
- [Session model](https://docs.builderforce.ai/concepts/session) — session isolation and group isolation
- [Multi-agent sandbox tools](https://docs.builderforce.ai/multi-agent-sandbox-tools) — per-group tool allow/deny policies
- [Channels](https://docs.builderforce.ai/channels) — per-channel setup guides
