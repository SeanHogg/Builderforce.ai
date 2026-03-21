---
title: Fleet Management — Running and Routing a CoderClaw Mesh
date: 2026-03-12
description: How to register, monitor, and route work across a fleet of CoderClaw instances from the Builderforce portal — covering heartbeats, capability declarations, smart routing, and the claw-to-claw mesh.
tags: [fleet, coderclaw, routing, mesh, capabilities, orchestration]
author: Sean Hogg
---

# Fleet Management — Running and Routing a CoderClaw Mesh

A single CoderClaw instance on a developer's laptop is already powerful. A fleet of ten — each specialised for a different kind of work, distributed across machines, routing tasks to whichever instance is best suited — is something else entirely.

Builderforce.ai is the control plane for that fleet. This post explains how to register instances, declare capabilities, route tasks intelligently, and monitor your mesh from the portal.

---

## What Is a Claw Fleet?

A **claw fleet** is all the CoderClaw instances registered to your tenant. Each instance is a machine running the CoderClaw gateway — it might be a developer's laptop, a dedicated server, a CI worker, or a cloud VM.

From the Builderforce portal, your fleet is visible at [Dashboard](/dashboard) and in the claw detail panel. Each claw shows:

- **Status** — online/offline (based on heartbeat recency)
- **Machine profile** — hostname, IP, workspace path, tunnel URL
- **Last seen** — when the claw last sent a heartbeat
- **Capabilities** — what the claw declares it can do
- **Assigned projects** — which projects are linked to it
- **Usage stats** — recent token consumption, execution count

---

## Registering a New Claw

To add a claw to your fleet:

1. Go to [Dashboard](/dashboard) → **Add Claw**
2. Give it a name and slug (e.g. `backend-server-1`)
3. Copy the generated API key — this is shown **once** and cannot be retrieved again
4. On the target machine, set:

```bash
export CODERCLAW_LINK_API_KEY=<your-api-key>
export CODERCLAW_LINK_URL=https://api.builderforce.ai
coderclaw start
```

The claw registers automatically on first heartbeat. Its machine profile, workspace path, and network metadata are populated from the first heartbeat payload.

---

## Heartbeats and Presence

A connected claw sends a **heartbeat** every 5 minutes via `PATCH /api/claws/:id/heartbeat`. The heartbeat updates:

- `lastSeenAt` — used to determine online/offline status
- `connectedAt` — set on the first heartbeat
- `capabilities` — the declared capability set (see below)
- `machineProfile` — hostname, IP, ports, tunnel URL

A claw is considered **online** if its `lastSeenAt` is within the last 10 minutes. If a claw goes offline, tasks assigned to it remain queued — they are not automatically re-routed unless you configure a fallback.

---

## Capability Declarations

Capabilities are the routing vocabulary of the mesh. A claw declares what it can do; the portal uses those declarations to route tasks to the best match.

Each claw declares capabilities in its heartbeat payload:

```json
{
  "capabilities": ["chat", "tasks", "relay", "remote-dispatch"],
  "declaredCapabilities": ["typescript", "react", "testing", "refactor"]
}
```

The first set (`capabilities`) is the CoderClaw protocol surface. The second (`declaredCapabilities`) is your custom vocabulary — whatever labels you use to categorise work.

### Querying by Capability

From any claw (or via the portal), you can ask: *"which claw in the fleet is best suited for this work?"*

```
GET /api/claws/fleet/route?requires=typescript,testing
```

This returns the best-matched online claw for the given capability set, prioritising claws that declare all requested capabilities.

---

## Smart Routing with `remote:auto`

The real power of capability declarations is **automatic routing** in CoderClaw workflows.

When you specify `remote:auto[caps]` as an agent role in a workflow, the dispatching claw queries the fleet, finds the best match, and forwards the task:

```yaml
# .coderClaw/workflows/feature-build.yaml
steps:
  - role: planner
    description: "Break down the feature into tasks"

  - role: remote:auto[typescript,react]
    description: "Implement the UI components"

  - role: remote:auto[testing]
    description: "Write unit tests for the implementation"

  - role: reviewer
    description: "Review the complete implementation"
```

The `remote:auto[typescript,react]` step dispatches to whatever online claw in the fleet best matches those two capabilities. If that claw is busy, the next-best match is selected.

---

## Manual Routing with `remote:<id>`

For cases where you want deterministic routing — always run the frontend tasks on a specific workstation — use the claw's slug or numeric ID directly:

```
remote:frontend-workstation
remote:42
```

This bypasses capability scoring and dispatches directly to that claw. If the claw is offline, the task fails immediately rather than falling back.

---

## The Claw Detail Panel

Click any claw in the [Dashboard](/dashboard) to open its detail panel. The panel has several tabs:

### Chat
A live terminal into the claw's active chat session — you can send tasks, see streaming responses, and watch the agent work in real time.

### Sessions
History of all sessions that ran on this claw, with start time, duration, and token usage. Click any session to see its full transcript.

### Projects
Which projects this claw is assigned to. You can assign and unassign projects from this tab.

### Skills
The skills currently loaded on this claw — both tenant-level assignments and claw-specific overrides. Changes here take effect the next time the claw restarts (skills are fetched at startup).

### Workspace
The directory this claw has synced to Builderforce — file inventory, sync status, and last sync timestamp.

### Usage
Per-session token consumption, context window utilisation, and compaction events. Useful for spotting context blowout before it becomes a problem.

### Debug
Raw machine profile, network metadata, relay connection status, and the last 20 heartbeat payloads. This is the first place to look when a claw is unexpectedly offline.

---

## Project Assignment

A claw without an assigned project has no context — it does not know which codebase, rules, or memory to load. Assign at least one project to each claw:

1. Open the claw detail panel → **Projects** tab
2. Click **Assign Project** and select the project
3. The claw fetches updated assignment context on its next heartbeat

A claw can be assigned to multiple projects. The active project is determined by the task being executed — the claw loads the matching project context automatically.

---

## Claw-to-Claw Dispatch

Claws in the same fleet can delegate tasks to each other directly, without routing through the portal. This is the **claw-to-claw mesh**.

All inter-claw dispatch is:

- **HMAC-signed** — each payload carries a `X-Claw-Signature: sha256=<hex>` header; the receiving claw verifies the signature before executing
- **Bearer-authenticated** — `Authorization: Bearer <apiKey>` on every request
- **Relay-assisted** — claws behind NAT or firewalls reach each other via the `ClawRelayDO` Durable Object on Builderforce; no direct network path required

The relay topology looks like this:

```
Claw A (laptop) ──────────────────────────────► Builderforce relay
                                                      │
                                         dispatches to Claw B via relay
                                                      │
                                              Claw B (server) ◄───────
```

Neither claw needs to be reachable from the other's network. Builderforce handles the routing.

---

## Fleet Visibility at Scale

For teams running many claws, the [Dashboard](/dashboard) fleet view shows all instances in a single table. You can filter by:

- **Status** — online only
- **Project** — claws assigned to a specific project
- **Capability** — claws that declare a given capability tag

The fleet view is the command-and-control surface for your mesh. Need to pause work on a claw? Change its status to `inactive`. Suspect a claw is misbehaving? Check its tool audit log. Need to roll out a new skill assignment to all claws? Update it at the tenant level and each claw picks it up at next startup.

---

## Best Practices

**Give claws meaningful names.** `claw-1`, `claw-2` becomes unmanageable fast. `backend-sean-mbp`, `frontend-ci-worker`, `refactor-server` makes the fleet view instantly readable.

**Declare capabilities precisely.** Avoid catch-all declarations like `general` or `everything`. The narrower your capability vocabulary, the better the auto-routing decisions. If a claw is good at Python and bad at TypeScript, declare `python` and not `typescript`.

**Assign one primary project per claw where possible.** Claws with many project assignments load more context at startup and may route work to the wrong project context. One claw, one codebase is the clearest mental model.

**Monitor `lastSeenAt` in production.** Set a Grafana alert (or use the portal's notification hooks once available) if a claw goes offline for more than 15 minutes during working hours — it usually means a process crash or network change.

---

## Next Steps

- Register a new claw from [Dashboard](/dashboard) → Add Claw
- Explore [Multi-Agent Orchestration](/blog/multi-agent-orchestration) to see how `remote:auto` fits into a full workflow
- Read [Skills Assignment](/blog/skills-assignment-and-the-marketplace) to understand how to equip your fleet's claws with portal-managed capabilities
