---
title: "Channel Routing"
summary: "How BuilderForce Agents routes inbound messages to agents and delivers replies back to channels"
---

# Channel Routing

Channel routing controls how inbound messages from any channel (WhatsApp, Telegram, Slack, Discord, etc.) are matched to an agent, and how the agent's reply is delivered back.

## Overview

When a message arrives at the Gateway:

1. **Channel receives** the raw message (via WebSocket, webhook, or polling)
2. **Access control** checks whether the sender is permitted (`allowFrom`, `groupPolicy`)
3. **Agent routing** selects which agent (workspace) should handle the message
4. **Session selection** finds or creates the right session for that conversation
5. **Reply routing** delivers the agent's response back to the originating channel

## Multi-Agent Routing

A single Gateway can run multiple isolated agents. Each agent has its own workspace, sessions, and config. You can route channels to specific agents based on:

- **Channel type** — e.g., all WhatsApp messages go to agent A, all Telegram to agent B
- **Account** — route a specific phone number or bot token to a dedicated agent
- **Group / server** — route a Discord server or Telegram group to a different agent

```yaml
agents:
  list:
    - id: personal
      channels:
        whatsapp: true
        telegram: true
    - id: work
      channels:
        slack: true
        discord: true
```

See [Gateway configuration](https://docs.builderforce.ai/gateway/configuration) for the full `agents.list` reference.

## Reply Routing

By default, replies go back to the channel the message came from. You can override this:

- **Cron jobs** — configure a `deliverTo` channel (chat, webhook, or both)
- **Webhooks** — replies POST back to the webhook caller, or to a separate channel
- **Cross-session messaging** — agents can send to other sessions via `sessions_send`

## Chunking and Streaming

Long replies are automatically chunked based on the channel's character limits:

| Channel  | Default chunk size         |
| -------- | -------------------------- |
| Telegram | 4096 characters            |
| WhatsApp | 4096 characters            |
| Discord  | 2000 characters            |
| Slack    | 3000 characters            |
| SMS      | 160 characters (1 segment) |

See [Streaming](https://docs.builderforce.ai/concepts/streaming) for details on block streaming and pacing.

## Retry Policy

If a message delivery fails, BuilderForce Agents retries with exponential backoff (default: 3 retries, up to 30s, with 10% jitter). See [Retry policy](https://docs.builderforce.ai/concepts/retry).

## See Also

- [Groups](https://docs.builderforce.ai/concepts/groups) — group allowlists, mention gating, group isolation
- [Group messages](https://docs.builderforce.ai/concepts/group-messages) — how group/server messages are handled
- [Session model](https://docs.builderforce.ai/concepts/session) — session isolation and activation modes
- [Gateway configuration](https://docs.builderforce.ai/gateway/configuration) — full agent routing config
- [Channels](https://docs.builderforce.ai/channels) — per-channel setup guides
