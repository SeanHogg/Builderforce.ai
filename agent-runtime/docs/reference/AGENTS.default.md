---
title: "Default AGENTS.md"
summary: "The default AGENTS.md template shipped with BuilderForce Agents workspaces"
---

# Default AGENTS.md

Every BuilderForce Agents workspace includes an `AGENTS.md` file at its root. This is the primary instruction file the agent reads at the start of each session — it defines how the agent should behave in that workspace.

## What It Does

`AGENTS.md` tells the agent:

- **What to read first** — soul, user profile, memory files
- **How to manage memory** — daily logs vs. curated long-term memory
- **Safety rules** — what requires confirmation, what's safe to do freely
- **Group chat behavior** — when to speak, when to stay quiet, how to react
- **Heartbeat behavior** — how to use scheduled heartbeats productively
- **Tool notes** — workspace-specific tool configuration (cameras, SSH hosts, etc.)

## The Default Template

The default template is available in the repo at [`foundation/AGENTS.md`](https://docs.builderforce.ai/reference/templates/agents). This is what gets placed in a new workspace when you run `builderforce onboard` or bootstrap a workspace manually.

You should edit `AGENTS.md` to reflect your specific needs — it's a starting point, not a final answer.

## Key Sections

### Every Session

The agent reads this file first every session and loads:

1. `SOUL.md` — personality and values
2. `USER.md` — who the human is and how to address them
3. `memory/YYYY-MM-DD.md` (today + yesterday) — recent context
4. `MEMORY.md` — long-term memory (main session only)

### Memory System

`AGENTS.md` defines two memory tiers:

- **Daily notes** (`memory/YYYY-MM-DD.md`) — raw session logs
- **Long-term memory** (`MEMORY.md`) — curated, distilled knowledge (main session only; never shared in group contexts for privacy)

### Heartbeats

The default `AGENTS.md` includes instructions for using heartbeat polls productively:

- Rotate between email, calendar, mentions, and weather checks
- Use `HEARTBEAT.md` for a short checklist of active tasks
- Respect quiet hours (23:00–08:00 unless urgent)

### Safety

Default rules:

- Don't exfiltrate private data
- Ask before destructive commands
- Prefer `trash` over `rm`

## Customizing

`AGENTS.md` is yours to edit. Common customizations:

- Add project-specific context (current sprint, team names, workflows)
- Change the heartbeat check list to match your actual tools
- Add formatting rules for your primary channels (Discord, WhatsApp, etc.)
- Include workspace-specific shortcuts and conventions

## Related Templates

- [SOUL.md](https://docs.builderforce.ai/reference/templates/soul) — agent personality and values
- [USER.md](https://docs.builderforce.ai/reference/templates/user) — user profile
- [IDENTITY.md](https://docs.builderforce.ai/reference/templates/identity) — agent name, creature, vibe, emoji
- [BOOTSTRAP.md](https://docs.builderforce.ai/reference/templates/bootstrap) — first-run onboarding ritual
- [TOOLS.md](https://docs.builderforce.ai/reference/templates/tools) — workspace-specific tool notes

## See Also

- [Agent workspace](https://docs.builderforce.ai/concepts/agent-workspace) — what belongs in the workspace directory
- [Onboarding wizard](https://docs.builderforce.ai/start/wizard) — guided workspace setup
- [Skills](https://docs.builderforce.ai/tools/skills) — extending agent capabilities
